import { describe, expect, it } from 'vitest';
import { unpackTake, type PackedTake } from '../src/tour/data';
import { allowedUrl, underBase } from '../src/tour/netGuard';
import { momentAt, replayCoach } from '../src/tour/replayCoach';
import expert from '../tour/data/expert.json';
import attempt from '../tour/data/attempt.json';
import takes from '../tour/takes.json';

describe('tour network guard', () => {
  const page = 'https://example.github.io/HackJunction2026/#/2';
  it('allows the page origin, data: and blob:', () => {
    expect(allowedUrl('./models/hands/right.glb', page)).toBe(true);
    expect(allowedUrl('/HackJunction2026/media/policy_demo.mp4', page)).toBe(true);
    expect(allowedUrl('data:image/png;base64,AAAA', page)).toBe(true);
  });
  it('refuses every other origin', () => {
    expect(allowedUrl('http://localhost:8000/api/health', page)).toBe(false);
    expect(allowedUrl('wss://example.com/ws', page)).toBe(false);
    expect(allowedUrl('https://cdn.example.org/model.task', page)).toBe(false);
  });
  it('puts root-absolute asset paths under the base path once', () => {
    expect(underBase('/models/robots/dex3_1/dex3_1_r.urdf', '/HackJunction2026/')).toBe('/HackJunction2026/models/robots/dex3_1/dex3_1_r.urdf');
    expect(underBase('/HackJunction2026/x', '/HackJunction2026/')).toBe('/HackJunction2026/x');
    expect(underBase('/models/x', '/')).toBe('/models/x');
    expect(underBase('./models/x', '/HackJunction2026/')).toBe('./models/x');
    expect(underBase('//evil.example/x', '/HackJunction2026/')).toBe('//evil.example/x');
  });
});

describe('tour data', () => {
  it('names each stop take in one config file', () => {
    for (const name of ['expert', 'attempt', 'rabbit', 'letter'] as const) {
      expect(takes[name].recorder).toMatch(/^[a-z0-9_-]+$/);
      expect(takes[name].take.startsWith(`${takes[name].recorder}-`)).toBe(true);
    }
  });
  it('bundles only frames: no ids, times or wearer names', () => {
    expect(Object.keys(expert).sort()).toEqual(['duration', 'fps', 'frames', 'side', 'title']);
    expect(JSON.stringify(expert)).not.toMatch(/arpan|szymon|guest|wearer|calibration|started_at/i);
  });
});

describe('training room replay', () => {
  const ref = unpackTake(expert as PackedTake);
  const att = unpackTake(attempt as PackedTake);
  const replay = replayCoach(ref.frames, att.frames, att.side);

  it('replays the attempt through the scorer to a score from 0 to 100', () => {
    expect(replay.moments.length).toBeGreaterThan(100);
    expect(replay.result.overall).toBeGreaterThanOrEqual(0);
    expect(replay.result.overall).toBeLessThanOrEqual(100);
  });
  it('flags a finger and gives a tip when the attempt strays', () => {
    expect(replay.moments.some((m) => m.flagged !== null && m.tip !== null)).toBe(true);
  });
  it('the same frames always give the same corrections', () => {
    const again = replayCoach(ref.frames, att.frames, att.side);
    expect(again.result.overall).toBe(replay.result.overall);
    expect(momentAt(again, 2)?.tip).toBe(momentAt(replay, 2)?.tip);
  });
});
