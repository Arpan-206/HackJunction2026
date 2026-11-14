import { Suspense, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { advance, createRoot, extend, useThree, type RootState } from '@react-three/fiber';
import * as THREE from 'three';
import { Material, Mesh, Texture, type Object3D, type Scene } from 'three';
import type { StageColors } from '../theme/themes';
import { loadHandTemplate } from './handModel';
import { PRESETS, Stage, type CameraPreset } from './Stage';
import { StageColorsContext } from './stageContext';
import { createStillQueue, stillDpr, stillKey, type StillQueue } from './stillQueue';

// <Canvas> registers the three.js classes as JSX elements itself; a root made with createRoot has to do it too.
extend(THREE);

/** What the renderer needs to draw one still. */
export interface StillJob {
  width: number;
  height: number;
  dpr: number;
  preset: CameraPreset;
  decor: boolean;
  colors: StageColors;
  content: ReactNode;
}

export interface StillPicture {
  /** Object URL of the rendered image. */
  url: string;
  width: number;
  height: number;
}

/** Give up waiting for textures and the environment after this long and draw what is there. */
const READY_TIMEOUT_MS = 6000;
/** After one miss (say the environment file is absent) later stills only wait this long. */
const READY_TIMEOUT_AFTER_MISS_MS = 1200;
/** The renderer and its WebGL context are released after this long with nothing to draw. */
const IDLE_RELEASE_MS = 20000;

function Aim({ preset }: { preset: CameraPreset }) {
  const camera = useThree((s) => s.camera);
  const p = PRESETS[preset];
  useLayoutEffect(() => {
    camera.position.set(...p.position);
    camera.near = 0.1;
    camera.far = 80;
    if ('fov' in camera) (camera as { fov: number }).fov = 30;
    camera.lookAt(...p.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }, [camera, p]);
  return null;
}

function Mounted({ onMounted }: { onMounted: () => void }) {
  useEffect(() => {
    onMounted();
  }, [onMounted]);
  return null;
}

/** Same set as a live preview: the carta azzurra, light, bench and the hand, from the preset's camera. */
function StillScene({ job, onMounted }: { job: StillJob; onMounted: () => void }) {
  const p = PRESETS[job.preset];
  return (
    <StageColorsContext.Provider value={job.colors}>
      <Aim preset={job.preset} />
      <Stage
        groundY={p.groundY}
        showGrid={false}
        circleRadius={p.circle}
        circleCenter={p.circleCenter}
        shadowSize={p.shadow}
        controls="none"
        target={p.target}
        cameraPosition={p.position}
        decor={job.decor}
        quality="low"
      />
      <Suspense fallback={null}>
        {job.content}
        <Mounted onMounted={onMounted} />
      </Suspense>
    </StageColorsContext.Provider>
  );
}

const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const;

/** True when every texture a material in the scene uses has its image (the PBR sets stream in after the mesh exists). */
function texturesLoaded(scene: Scene): boolean {
  let ok = true;
  scene.traverse((o: Object3D) => {
    if (!ok || !(o instanceof Mesh)) return;
    const mats = (Array.isArray(o.material) ? o.material : [o.material]) as Material[];
    for (const m of mats) {
      for (const k of MAPS) {
        const t = (m as unknown as Record<string, unknown>)[k];
        if (t instanceof Texture && !t.image) ok = false;
      }
    }
  });
  return ok;
}

const nextTick = (ms = 16) => new Promise<void>((r) => setTimeout(r, ms));

interface Renderer {
  canvas: HTMLCanvasElement;
  root: ReturnType<typeof createRoot>;
  state: RootState | null;
  lost: boolean;
}

/** Set once an environment never showed up, so later stills do not each wait the full timeout. */
let envMissed = false;
let renderer: Renderer | null = null;
let sceneSerial = 0;
let idleTimer: number | undefined;

function release(): void {
  if (!renderer) return;
  const r = renderer;
  renderer = null;
  try {
    r.root.unmount();
  } catch {
    /* already gone */
  }
  try {
    r.state?.gl.forceContextLoss();
    r.state?.gl.dispose();
  } catch {
    /* already lost */
  }
}

function acquire(): Renderer {
  if (renderer && !renderer.lost) return renderer;
  release();
  const canvas = document.createElement('canvas');
  const root = createRoot(canvas);
  const r: Renderer = { canvas, root, state: null, lost: false };
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    r.lost = true;
  });
  configure(r, 100, 100, 1);
  renderer = r;
  return r;
}

/**
 * Every configure call must repeat the whole config: r3f resets anything left out (frameloop would go back to 'always').
 */
function configure(r: Renderer, width: number, height: number, dpr: number): void {
  r.root.configure({
    flat: true,
    frameloop: 'never',
    dpr,
    size: { width, height, top: 0, left: 0 },
    gl: { antialias: true, alpha: false, stencil: true, preserveDrawingBuffer: true },
    camera: { position: [0, 0, 5], fov: 30, near: 0.1, far: 80 },
    onCreated: (s) => {
      r.state = s;
    },
  });
}

async function drawOnce(job: StillJob): Promise<StillPicture | null> {
  await loadHandTemplate();
  const r = acquire();
  configure(r, job.width, job.height, job.dpr);
  let mounted = false;
  const store = r.root.render(<StillScene key={(sceneSerial += 1)} job={job} onMounted={() => (mounted = true)} />);
  const started = performance.now();
  const limit = envMissed ? READY_TIMEOUT_AFTER_MISS_MS : READY_TIMEOUT_MS;
  for (;;) {
    await nextTick();
    const s = store.getState();
    if (r.lost || s.gl.getContext().isContextLost()) return null;
    advance(performance.now() / 1000, true, s);
    const env = !job.decor || s.scene.environment !== null;
    if (mounted && texturesLoaded(s.scene) && env) break;
    if (performance.now() - started > limit) {
      if (!env) envMissed = true;
      break;
    }
  }
  const s = store.getState();
  // Two frames: the first applies the pose in the hand's frame callback, the second draws it settled.
  advance(performance.now() / 1000 + 0.016, true, s);
  advance(performance.now() / 1000 + 0.032, true, s);
  if (s.gl.getContext().isContextLost()) return null;
  const blob = await new Promise<Blob | null>((resolve) => r.canvas.toBlob(resolve, 'image/webp', 0.92));
  if (!blob || r.lost) return null;
  return { url: URL.createObjectURL(blob), width: job.width, height: job.height };
}

/** One attempt on a fresh context if the first lost its context, so a dropped context never leaves a blank card. */
async function render(job: StillJob): Promise<StillPicture | null> {
  window.clearTimeout(idleTimer);
  try {
    let pic = await drawOnce(job);
    if (!pic) pic = await drawOnce(job);
    return pic;
  } catch (e) {
    console.error('[still] could not draw a hand picture', e);
    release();
    return null;
  } finally {
    // Rendering the next job replaces this one's content; free the context only after a quiet spell.
    idleTimer = window.setTimeout(release, IDLE_RELEASE_MS);
  }
}

let queue: StillQueue<StillPicture> | null = null;

/** The shared queue: one offscreen renderer, one picture at a time, results cached by key. */
export function getStillQueue(): StillQueue<StillPicture> {
  queue ??= createStillQueue<StillPicture>({ onEvict: (p) => URL.revokeObjectURL(p.url) });
  return queue;
}

/** Asks for the picture of a still; cached pictures come back at once. */
export function requestStill(id: string, job: StillJob) {
  const key = keyOf(id, job);
  return { key, req: getStillQueue().request(key, () => render(job)) };
}

/** The cache key of a still: its id plus everything about the job that changes the pixels. */
export function keyOf(id: string, job: Omit<StillJob, 'content'>): string {
  return stillKey({ id, preset: job.preset, decor: job.decor, colors: job.colors, width: job.width, height: job.height, dpr: job.dpr });
}

export { stillDpr };
