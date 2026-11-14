import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { CastShadows, KeyLight, Stage } from '../three';
import { StageColorsContext } from '../three/stageContext';
import { THEMES } from '../theme/themes';

export interface StillJob {
  id: string;
  /** Scene contents on the walnut bench. */
  scene: ReactNode;
  camera?: { position: [number, number, number]; target: [number, number, number] };
}

const CAM = { position: [1.7, 1.85, 2.9] as [number, number, number], target: [0, -0.15, -0.75] as [number, number, number] };

function Capture({ job, first, onShot }: { job: StillJob; first: boolean; onShot: (url: string) => void }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const frames = useRef(0);
  const start = useRef(performance.now());
  const done = useRef(false);
  useEffect(() => {
    const c = job.camera ?? CAM;
    camera.position.set(...c.position);
    camera.lookAt(...c.target);
    frames.current = 0;
    start.current = performance.now();
    done.current = false;
  }, [job, camera]);
  useFrame(() => {
    frames.current += 1;
    // The first still waits for the bench, wall and light maps; later ones reuse the cached textures.
    const wait = first ? 2600 : 500;
    if (done.current || frames.current < 6 || performance.now() - start.current < wait) return;
    done.current = true;
    onShot(gl.domElement.toDataURL('image/jpeg', 0.9));
  });
  return null;
}

/**
 * Renders every skill card image as a still from ONE shared WebGL canvas, one scene after another, then removes the
 * canvas. Cards show plain images, so a page of skills costs one context for a moment instead of eight live ones.
 */
export function useStills(jobs: StillJob[]): { urls: Record<string, string>; host: ReactNode } {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const job = jobs[index];
  const host = job ? (
    <div data-stills="wait" aria-hidden="true" style={{ position: 'fixed', left: -2000, top: 0, width: 640, height: 360, pointerEvents: 'none' }}>
      <Canvas shadows flat dpr={1} camera={{ position: CAM.position, fov: 30, near: 0.1, far: 80 }} gl={{ antialias: true, stencil: true, preserveDrawingBuffer: true }}>
        <StageColorsContext.Provider value={THEMES.bottega.stage}>
          <Stage groundY={-0.55} showCircle={false} circleCenter={[0, -0.7]} circleRadius={1.4} controls="none" decor quality="low" target={CAM.target} cameraPosition={CAM.position} />
          <KeyLight position={[-2.2, 6, 3.4]} intensity={0.9} color="#FFE9CC" span={3} />
          <CastShadows />
          <group key={job.id}>{job.scene}</group>
          <Capture
            job={job}
            first={index === 0}
            onShot={(url) => {
              setUrls((u) => ({ ...u, [job.id]: url }));
              setIndex((i) => i + 1);
            }}
          />
        </StageColorsContext.Provider>
      </Canvas>
    </div>
  ) : (
    <span data-stills="done" hidden />
  );
  return { urls, host };
}
