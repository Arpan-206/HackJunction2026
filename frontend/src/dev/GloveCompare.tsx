import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera, Vector3, type Object3D } from 'three';
import { api, useGloveStream } from '../api';
import { calibrateCoreHeading, coreEndpoint } from '../api/coreCommand';
import type { GloveFrame, Side } from '../api/types';
import { Hand, type HandHandle } from '../three';
import { HAND_SCALE } from '../three/handModel';
import { isDev } from '../features/apprentice/pipeline/flags';

/**
 * Dev only (/dev/glove-compare): the glove core's own skeleton beside our skinned hands, both hands, same camera
 * direction, so a pose that looks wrong on our side can be compared joint by joint with what the core sends.
 *
 * Left: the core's 26 joints per hand from its main socket (SPEC.md `/ws`), drawn exactly as tools/debug_view.html
 * draws them (same chains, same projection: front view x right, y up; top view x right, z down). Right: our hands from
 * the backend's /ws/gloves through the normal pipeline (<Hand live>), each wrist placed where the core puts it, seen by
 * an orthographic camera with the same scale and direction, so the two panels overlay.
 *
 * A guided capture records, per movement, every core frame (all fields), every backend GloveFrame and what our rig drew
 * (each bone's local rotation and its position in metres in the same world frame as the core's joints), and saves it with
 * a side by side snapshot through POST /api/dev/glove_compare into backend/data/glove_compare/<session>/.
 */

type View = 'front' | 'top';

/** The core skeleton chains, joint indices from the wrist (core/hand.py JOINT_NAMES), as the debug view draws them. */
const CHAINS = [
  [1, 2, 3, 4, 5],
  [1, 6, 7, 8, 9, 10],
  [1, 11, 12, 13, 14, 15],
  [1, 16, 17, 18, 19, 20],
  [1, 21, 22, 23, 24, 25],
];
const PALM = [1, 6, 11, 16, 21, 1];
const SIDES: Side[] = ['left', 'right'];
const PANEL = { w: 560, h: 460 };
/** tools/debug_view.html: pixels per metre is min(w, h) * 1.6; the front view puts y = 0 at 62% of the height. */
const PX_PER_M = Math.min(PANEL.w, PANEL.h) * 1.6;
const FRONT_Y0 = 0.62;
const COUNTDOWN_S = 3;
const SAMPLE_MS = 1000 / 30;

interface Movement {
  slug: string;
  title: string;
  seconds: number;
}

/** What the wearer does for each capture, both hands at once. */
const MOVEMENTS: Movement[] = [
  { slug: 'flat-spread', title: 'Flat, palms down, fingers spread, pointing at the screen. Hold still.', seconds: 4 },
  { slug: 'fist-open', title: 'Slowly make a fist and open again, 3 times.', seconds: 8 },
  { slug: 'point', title: 'Point with the index finger, the other fingers curled, thumb out to the side.', seconds: 4 },
  { slug: 'thumbs-up', title: 'Thumbs up: a fist with the thumb pointing up.', seconds: 4 },
  { slug: 'pinch-each', title: 'Pinch the thumb to each fingertip in turn: index, middle, ring, little.', seconds: 8 },
  { slug: 'together-spread', title: 'Fingers together, then spread them wide. Twice.', seconds: 6 },
  { slug: 'each-finger', title: 'Bend each finger on its own, thumb first, then index, middle, ring, little.', seconds: 10 },
  { slug: 'claw', title: 'Claw: bend only the top two joints of each finger, knuckles straight.', seconds: 4 },
  { slug: 'wrist', title: 'Wrist: palm down to palm up and back, tilt the fingers up and down, turn left and right.', seconds: 8 },
  { slug: 'ok-sign', title: 'OK sign: thumb and index tips touching in a ring, the other fingers straight.', seconds: 4 },
];

interface CoreHand {
  joints: number[][];
  role?: string;
  source?: string;
  tracked?: boolean;
  wrist?: { p: number[]; q: number[] };
}
interface CoreFrame {
  type: 'frame';
  hands?: Partial<Record<Side, CoreHand | null>>;
  [k: string]: unknown;
}

interface RigSample {
  t: number;
  hands: Partial<Record<Side, { bones: { name: string; q: number[]; p: number[] }[]; joint_weight: number; core_angles: boolean }>>;
}

interface Capture {
  movement: Movement;
  startedAt: number;
  core: { t: number; frame: CoreFrame }[];
  backend: { t: number; frame: GloveFrame }[];
  rig: RigSample[];
}

/** The core's main socket, reconnecting; the latest frame lands in a ref and every frame goes to `onFrame`. */
function useCoreFrames(onFrame: MutableRefObject<((f: CoreFrame) => void) | null>) {
  const latest = useRef<CoreFrame | null>(null);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: number | undefined;
    let alive = true;
    const open = () => {
      setStatus('connecting');
      ws = new WebSocket(coreEndpoint());
      ws.onopen = () => setStatus('open');
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        try {
          const m = JSON.parse(ev.data) as CoreFrame;
          if (m.type !== 'frame') return;
          latest.current = m;
          onFrame.current?.(m);
        } catch {
          /* not JSON */
        }
      };
      ws.onerror = () => ws?.close();
      ws.onclose = () => {
        setStatus('closed');
        if (alive) timer = window.setTimeout(open, 2000);
      };
    };
    open();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [onFrame]);
  return { latest, status };
}

/** Draws the core skeleton like tools/debug_view.html, every animation frame. */
function SkeletonPanel({ latest, view, canvasRef }: { latest: MutableRefObject<CoreFrame | null>; view: View; canvasRef: MutableRefObject<HTMLCanvasElement | null> }) {
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      const { w, h } = PANEL;
      ctx.fillStyle = '#14161b';
      ctx.fillRect(0, 0, w, h);
      const project = (p: number[]): [number, number] => [w / 2 + p[0] * PX_PER_M, view === 'top' ? h / 2 + p[2] * PX_PER_M : h * FRONT_Y0 - p[1] * PX_PER_M];
      ctx.strokeStyle = '#2a2d35';
      ctx.lineWidth = 1;
      const o = project([0, 0, 0]);
      ctx.beginPath();
      ctx.moveTo(0, o[1]);
      ctx.lineTo(w, o[1]);
      ctx.moveTo(o[0], 0);
      ctx.lineTo(o[0], h);
      ctx.stroke();
      const f = latest.current;
      for (const side of SIDES) {
        const hd = f?.hands?.[side];
        if (!hd?.joints || hd.joints.length !== 26) continue;
        const pts = hd.joints.map(project);
        const colour = hd.tracked === false ? '#666' : side === 'right' ? '#9cf' : '#c9a';
        ctx.lineWidth = 3;
        ctx.strokeStyle = colour;
        for (const chain of CHAINS) {
          ctx.beginPath();
          ctx.moveTo(...pts[chain[0]]);
          chain.slice(1).forEach((j) => ctx.lineTo(...pts[j]));
          ctx.stroke();
        }
        ctx.beginPath();
        PALM.forEach((j, i) => (i ? ctx.lineTo(...pts[j]) : ctx.moveTo(...pts[j])));
        ctx.stroke();
        ctx.fillStyle = '#eee';
        pts.forEach((p, i) => {
          ctx.beginPath();
          ctx.arc(p[0], p[1], i === 1 ? 5 : 2.5, 0, 7);
          ctx.fill();
        });
        ctx.fillStyle = colour;
        ctx.font = '16px sans-serif';
        ctx.fillText(`${side} ${hd.role ?? ''} ${hd.source ?? ''}`, pts[1][0] + 8, pts[1][1] - 10);
      }
      ctx.fillStyle = '#888';
      ctx.font = '16px sans-serif';
      ctx.fillText(view === 'top' ? 'core skeleton, top view' : 'core skeleton, front view', 10, h - 12);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [latest, view, canvasRef]);
  return <canvas ref={canvasRef} width={PANEL.w} height={PANEL.h} style={{ width: PANEL.w, height: PANEL.h, display: 'block' }} />;
}

/** An orthographic camera with the debug view's scale and direction (scene units are HAND_SCALE per metre). */
function CompareCamera({ view }: { view: View }) {
  const set = useThree((s) => s.set);
  const size = useThree((s) => s.size);
  useEffect(() => {
    const cam = new OrthographicCamera(-size.width / 2, size.width / 2, size.height / 2, -size.height / 2, 0.1, 100);
    cam.zoom = PX_PER_M / HAND_SCALE;
    if (view === 'top') {
      cam.position.set(0, 30, 0);
      cam.up.set(0, 0, -1);
      cam.lookAt(0, 0, 0);
    } else {
      // The debug view's y = 0 sits at 62% of the height, so the camera centre is above it.
      const yc = ((FRONT_Y0 - 0.5) * PANEL.h * HAND_SCALE) / PX_PER_M;
      cam.position.set(0, yc, 30);
      cam.up.set(0, 1, 0);
      cam.lookAt(0, yc, 0);
    }
    cam.updateProjectionMatrix();
    set({ camera: cam });
  }, [view, size.width, size.height, set]);
  return null;
}

/** Samples what the rig drew, about 30 times a second while a capture runs. */
function RigSampler({ hands, capture }: { hands: Record<Side, MutableRefObject<HandHandle | null>>; capture: MutableRefObject<Capture | null> }) {
  const last = useRef(0);
  const v = useRef(new Vector3());
  useFrame(() => {
    const cap = capture.current;
    if (!cap) return;
    const now = performance.now();
    if (now - last.current < SAMPLE_MS) return;
    last.current = now;
    const sample: RigSample = { t: Math.round(now - cap.startedAt), hands: {} };
    for (const side of SIDES) {
      const h = hands[side].current;
      if (!h) continue;
      sample.hands[side] = {
        joint_weight: round(h.smoother.jointWeight),
        core_angles: h.smoother.coreAngles,
        bones: h.rig.bones.map((b: Object3D) => {
          b.getWorldPosition(v.current);
          return { name: b.name, q: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w].map(round), p: [v.current.x, v.current.y, v.current.z].map((x) => round(x / HAND_SCALE)) };
        }),
      };
    }
    cap.rig.push(sample);
  });
  return null;
}

const round = (x: number) => Math.round(x * 1e5) / 1e5;

function OurHands({
  live,
  core,
  view,
  hands,
  capture,
}: {
  live: MutableRefObject<GloveFrame | null>;
  core: MutableRefObject<CoreFrame | null>;
  view: View;
  hands: Record<Side, MutableRefObject<HandHandle | null>>;
  capture: MutableRefObject<Capture | null>;
}) {
  return (
    <Canvas gl={{ antialias: true, preserveDrawingBuffer: true }} style={{ width: PANEL.w, height: PANEL.h, background: '#14161b' }} frameloop="always">
      <CompareCamera view={view} />
      <color attach="background" args={['#14161b']} />
      <hemisphereLight args={['#ffffff', '#445566', 1.6]} />
      <directionalLight position={[2, 6, 4]} intensity={0.9} />
      {SIDES.map((side) => (
        <WristAt key={side} side={side} core={core}>
          <Hand ref={hands[side]} side={side} style="chalk" live={live} centred={false} />
        </WristAt>
      ))}
      <RigSampler hands={hands} capture={capture} />
    </Canvas>
  );
}

/** Holds a hand's wrist where the core puts it (metres to scene units), so both panels place the hands alike. */
function WristAt({ side, core, children }: { side: Side; core: MutableRefObject<CoreFrame | null>; children: React.ReactNode }) {
  const g = useRef<import('three').Group>(null);
  useFrame(() => {
    const p = core.current?.hands?.[side]?.wrist?.p;
    if (g.current && p) g.current.position.set(p[0] * HAND_SCALE, p[1] * HAND_SCALE, p[2] * HAND_SCALE);
  });
  return (
    <group ref={g} position={[side === 'left' ? -1.8 : 1.8, 1.2, -2.4]}>
      {children}
    </group>
  );
}

function sessionId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `s${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export default function GloveCompare() {
  if (!isDev()) return <Navigate replace to="/" />;
  return <GloveComparePage />;
}

function GloveComparePage() {
  const [view, setView] = useState<View>('front');
  const [calib, setCalib] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState<{ kind: 'idle' } | { kind: 'countdown'; left: number } | { kind: 'capturing'; left: number } | { kind: 'saving' }>({ kind: 'idle' });
  const [saved, setSaved] = useState<Record<number, string>>({});
  const [session] = useState(sessionId);
  const capture = useRef<Capture | null>(null);
  const onCore = useRef<((f: CoreFrame) => void) | null>((f) => {
    const cap = capture.current;
    if (cap) cap.core.push({ t: Math.round(performance.now() - cap.startedAt), frame: f });
  });
  const core = useCoreFrames(onCore);
  const gloves = useGloveStream(true);
  const skeleton = useRef<HTMLCanvasElement | null>(null);
  const ours = useRef<HTMLDivElement | null>(null);
  const hands = { left: useRef<HandHandle | null>(null), right: useRef<HandHandle | null>(null) };
  const snapshot = useRef<string | null>(null);

  useEffect(
    () =>
      gloves.onFrame((f) => {
        const cap = capture.current;
        if (cap) cap.backend.push({ t: Math.round(performance.now() - cap.startedAt), frame: f });
      }),
    [gloves],
  );

  const calibrate = async () => {
    setCalib('Both hands flat, palms down, fingers pointing at the screen, hold still...');
    const ok = await calibrateCoreHeading();
    setCalib(ok ? 'Calibrated: both views now face the same way.' : 'The core did not answer the calibrate command.');
  };

  /** Both panels side by side in one PNG. */
  const takeSnapshot = (): string | null => {
    const a = skeleton.current;
    const b = ours.current?.querySelector('canvas');
    if (!a || !b) return null;
    const c = document.createElement('canvas');
    c.width = PANEL.w * 2 + 8;
    c.height = PANEL.h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(a, 0, 0, PANEL.w, PANEL.h);
    ctx.drawImage(b, PANEL.w + 8, 0, PANEL.w, PANEL.h);
    return c.toDataURL('image/png');
  };

  const start = async (i: number) => {
    const m = MOVEMENTS[i];
    for (let left = COUNTDOWN_S; left > 0; left--) {
      setPhase({ kind: 'countdown', left });
      await wait(1000);
    }
    snapshot.current = null;
    capture.current = { movement: m, startedAt: performance.now(), core: [], backend: [], rig: [] };
    const end = performance.now() + m.seconds * 1000;
    let snapped = false;
    while (performance.now() < end) {
      setPhase({ kind: 'capturing', left: Math.ceil((end - performance.now()) / 1000) });
      if (!snapped && performance.now() > end - (m.seconds * 1000) / 2) {
        snapshot.current = takeSnapshot();
        snapped = true;
      }
      await wait(200);
    }
    const cap = capture.current;
    capture.current = null;
    setPhase({ kind: 'saving' });
    try {
      const r = await api.saveGloveCompare({
        session,
        index: i + 1,
        slug: m.slug,
        data: {
          movement: { index: i + 1, slug: m.slug, title: m.title, seconds: m.seconds },
          view,
          recorded_at: new Date().toISOString(),
          notes: 'core: SPEC /ws frames as sent (joints in world metres). backend: /ws/gloves GloveFrames. rig: our bones per sample, q local, p world metres (scene / HAND_SCALE), same world frame as the core joints.',
          core: cap?.core ?? [],
          backend: cap?.backend ?? [],
          rig: cap?.rig ?? [],
        },
        png: snapshot.current,
      });
      setSaved((s) => ({ ...s, [i]: r.json_path }));
      setCurrent(Math.min(MOVEMENTS.length - 1, i + 1));
    } catch (e) {
      setSaved((s) => ({ ...s, [i]: `Not saved: ${e instanceof Error ? e.message : String(e)}` }));
    }
    setPhase({ kind: 'idle' });
  };

  const busy = phase.kind !== 'idle';
  const m = MOVEMENTS[current];
  return (
    <main style={{ padding: '1rem', fontSize: 16, display: 'grid', gap: '0.75rem', background: '#0e0f12', color: '#ddd', minHeight: '100vh' }}>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Glove compare</h1>
        <span>core {core.status}, backend {gloves.status}, session {session}</span>
        <Link to="/" style={{ color: '#9cf' }}>
          Back
        </Link>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void calibrate()} disabled={busy}>
          Calibrate
        </button>
        <span>{calib ?? 'Calibrate first: both hands flat, palms down, fingers pointing at the screen, hold still.'}</span>
        <span style={{ marginLeft: 'auto' }}>View</span>
        {(['front', 'top'] as View[]).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} style={{ fontWeight: view === v ? 700 : 400 }}>
            {v === 'front' ? 'Front' : 'Top'}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <figure style={{ margin: 0 }}>
          <SkeletonPanel latest={core.latest} view={view} canvasRef={skeleton} />
          <figcaption>Core skeleton (what the debug view draws)</figcaption>
        </figure>
        <figure style={{ margin: 0 }} ref={ours}>
          <OurHands live={gloves.latest} core={core.latest} view={view} hands={hands} capture={capture} />
          <figcaption>Our hands (normal pipeline)</figcaption>
        </figure>
      </div>
      <section style={{ display: 'grid', gap: '0.5rem', maxWidth: 1130 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>
          Movement {current + 1} of {MOVEMENTS.length}: {m.title}
        </h2>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button type="button" onClick={() => void start(current)} disabled={busy} style={{ fontSize: 22, padding: '0.6rem 2rem' }}>
            Start
          </button>
          <span style={{ fontSize: 22 }} role="status">
            {phase.kind === 'countdown' && `Get ready: ${phase.left}`}
            {phase.kind === 'capturing' && `Recording: ${phase.left} s`}
            {phase.kind === 'saving' && 'Saving...'}
            {phase.kind === 'idle' && `${m.seconds} s capture after a ${COUNTDOWN_S} s countdown`}
          </span>
        </div>
        <ol style={{ margin: 0, paddingLeft: '1.5rem' }}>
          {MOVEMENTS.map((mv, i) => (
            <li key={mv.slug} style={{ fontWeight: i === current ? 700 : 400 }}>
              <button type="button" onClick={() => setCurrent(i)} disabled={busy} style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
                {mv.title}
              </button>{' '}
              {saved[i] && <span style={{ color: '#9c9' }}>{saved[i]}</span>}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
