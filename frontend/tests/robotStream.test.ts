import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandFrame } from '../src/api/types';
import type { RobotMessage } from '../src/api/robotTypes';
import { LagMeter, RobotStore, robotSocketUrl, type RobotStoreOptions } from '../src/api/useRobotStream';
import { parseUrdf } from '../src/three/robot/urdf';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const urdf = (f: string) => parseUrdf(readFileSync(path.resolve(here, '../public/models/robots/dex3_1', f), 'utf8'));
const models = { left: urdf('dex3_1_l.urdf'), right: urdf('dex3_1_r.urdf') };

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({});
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  fail() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

let sockets: FakeSocket[] = [];
function makeStore(over: Partial<RobotStoreOptions> = {}) {
  return new RobotStore({
    coreUrl: 'http://localhost:8765',
    mockOnly: () => false,
    openSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    loadModels: () => Promise.resolve(models),
    now: () => Date.now(),
    ...over,
  });
}

const flatHand = (deg: number): HandFrame => {
  const r = (deg * Math.PI) / 180;
  return {
    side: 'right',
    wrist_quat: [0, 0, 0, 1],
    wrist_pos: null,
    flexion: { thumb: [0, r, r], index: [r, r, r], middle: [r, r, r], ring: [r, r, r], little: [r, r, r] },
    spread: { thumb: 0, index: 0, middle: 0, ring: 0, little: 0 },
  };
};

beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('robot socket URL', () => {
  it('turns the core address into its /ws/robot socket', () => {
    expect(robotSocketUrl('http://localhost:8765')).toBe('ws://localhost:8765/ws/robot');
    expect(robotSocketUrl('https://core.example:9000/')).toBe('wss://core.example:9000/ws/robot');
  });
});

describe('robot stream against the core', () => {
  it('reads hello.robot, streams robot messages and sends set_robot_source in the cmd envelope', async () => {
    const store = makeStore();
    const release = store.acquire();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('ws://localhost:8765/ws/robot');
    expect(store.getState().link).toBe('connecting');
    sockets[0].open();
    expect(store.getState().link).toBe('core');
    sockets[0].receive({
      v: 1,
      type: 'hello',
      fake: true,
      robot: { model: 'dex3_1', fingers: ['thumb', 'index', 'middle'], missing: ['ring', 'little'], joints: { left: [], right: ['right_hand_index_0_joint'] }, limits: { left: {}, right: {} }, urdf: { left: 'l', right: 'r' } },
      session: { roles: { right: 'master' }, robot_source: 'off', lesson_id: null },
    });
    const st = store.getState();
    expect(st.robot?.model).toBe('dex3_1');
    expect(st.described).toBe(true);
    expect(st.fake).toBe(true);
    expect(st.roles).toEqual({ right: 'master' });

    const got: RobotMessage[] = [];
    store.onMessage((m) => got.push(m));
    const msg = { v: 1, type: 'robot', t: 1, model: 'dex3_1', source: 'master', hand: 'right', q: { right_hand_index_0_joint: 0.4 }, fidelity: { index: 0.667 }, missing: ['ring', 'little'] };
    sockets[0].receive(msg);
    expect(got).toHaveLength(1);
    expect(store.latest?.q.right_hand_index_0_joint).toBe(0.4);

    const p = store.setSource('master');
    const cmd = JSON.parse(sockets[0].sent[0]);
    expect(cmd).toMatchObject({ v: 1, type: 'cmd', name: 'set_robot_source', args: { source: 'master' } });
    expect(typeof cmd.id).toBe('string');
    sockets[0].receive({ v: 1, type: 'ack', t: 2, id: cmd.id, ok: true, result: { source: 'master', model: 'dex3_1' } });
    await p;
    expect(store.getState().source).toBe('master');

    const bad = store.setSource('lesson');
    const cmd2 = JSON.parse(sockets[0].sent[1]);
    sockets[0].receive({ v: 1, type: 'ack', t: 3, id: cmd2.id, ok: false, error: { code: 'bad_state', message: 'robot output unavailable' } });
    await expect(bad).rejects.toThrow(/unavailable/);
    expect(store.getState().error).toMatch(/unavailable/);

    release();
    const last = JSON.parse(sockets[0].sent.at(-1) as string);
    expect(last).toMatchObject({ name: 'set_robot_source', args: { source: 'off' } });
    expect(sockets[0].closed).toBe(true);
  });

  it('falls back to the browser retarget when the core is down, and keeps retrying quietly', async () => {
    const store = makeStore();
    store.acquire();
    sockets[0].fail();
    expect(store.getState().link).toBe('mock');
    expect(store.getState().coreDown).toBe(true);
    await vi.waitFor(() => expect(store.getState().robot?.model).toBe('dex3_1'));
    expect(store.getState().robot?.missing).toEqual(['ring', 'little']);

    store.setMockInput(() => ({ hand: flatHand(30), from: 'hand' }));
    await store.setSource('learner');
    const got: RobotMessage[] = [];
    store.onMessage((m) => got.push(m));
    vi.advanceTimersByTime(100);
    expect(got.length).toBeGreaterThan(3);
    expect(got[0]).toMatchObject({ type: 'robot', source: 'learner', hand: 'right', angles_from: 'hand' });
    expect(got[0].q.right_hand_index_0_joint).toBeCloseTo(0.5236, 4);

    vi.advanceTimersByTime(1000);
    expect(sockets.length).toBe(2);
    sockets[1].open();
    expect(store.getState().link).toBe('core');
    expect(store.getState().source).toBe('off');
    const before = got.length;
    vi.advanceTimersByTime(200);
    expect(got.length).toBe(before);
  });

  it('a socket that never opens counts as down after a while', () => {
    const store = makeStore();
    store.acquire();
    expect(store.getState().link).toBe('connecting');
    vi.advanceTimersByTime(2100);
    expect(store.getState().link).toBe('mock');
  });

  it('never tries the core in explicit mock mode', async () => {
    const store = makeStore({ mockOnly: () => true });
    store.acquire();
    expect(sockets).toHaveLength(0);
    expect(store.getState()).toMatchObject({ link: 'mock', mockOnly: true, coreDown: false });
    await vi.waitFor(() => expect(store.getState().described).toBe(true));
    await expect(store.send('ping')).rejects.toThrow(/not connected/);
  });
});

describe('lag meter', () => {
  it('times a glove change to the next robot message that moved', () => {
    const m = new LagMeter();
    m.glove([0, 0], 0);
    m.robot({ a: 0 }, 5);
    m.glove([0.1, 0], 100);
    m.robot({ a: 0 }, 110);
    expect(m.value).toBeNull();
    m.robot({ a: 0.05 }, 130);
    expect(m.value).toBe(30);
    m.glove([0.2, 0], 200);
    m.robot({ a: 0.1 }, 210);
    expect(m.value).toBeCloseTo(0.8 * 30 + 0.2 * 10, 9);
  });

  it('ignores glove noise and drops changes the robot never answers', () => {
    const m = new LagMeter();
    m.glove([0, 0], 0);
    m.robot({ a: 0 }, 0);
    m.glove([0.005, 0.005], 10);
    m.robot({ a: 0.1 }, 20);
    expect(m.value).toBeNull();
    m.glove([0.5, 0], 30);
    m.glove([0.5, 0], 2000);
    m.robot({ a: 0.3 }, 2010);
    expect(m.value).toBeNull();
  });
});
