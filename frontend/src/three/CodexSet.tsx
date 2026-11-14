import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CanvasTexture, Color, DirectionalLight, Mesh, MeshBasicMaterial, type Material } from 'three';
import { getParchmentTexture } from './parchment';
import { createHatchedShadowMaterial } from './sketch';
import { useStageColors } from './stageContext';

/**
 * Turns on shadow casting for every opaque mesh in the scene and shadow receiving for everything, re-checked a few
 * times a second so hands and props mounted later join in. Translucent meshes (ghosts, shadows) never cast.
 */
export function CastShadows() {
  const scene = useThree((s) => s.scene);
  const tick = useRef(0);
  useFrame(() => {
    if (tick.current++ % 15 !== 0) return;
    scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const mat = m.material as Material | Material[];
      const clear = Array.isArray(mat) ? false : mat.transparent;
      if (m.userData.noCast !== true) m.castShadow = !clear;
      m.receiveShadow = m.userData.receive === true || (m.userData.noReceive !== true && !clear);
    });
  });
  return null;
}

/** A warm key light that casts the shadows; sized for a stage a few units across. */
export function KeyLight({ position = [-2.6, 5.2, 3.2], intensity = 1.7, color = '#FFE6BF', span = 4 }: { position?: [number, number, number]; intensity?: number; color?: string; span?: number }) {
  const light = useRef<DirectionalLight>(null);
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    l.shadow.mapSize.set(2048, 2048);
    l.shadow.bias = -0.0006;
    l.shadow.normalBias = 0.02;
    const cam = l.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 0.5;
    cam.far = 20;
    cam.updateProjectionMatrix();
  }, [span]);
  return <directionalLight ref={light} position={position} intensity={intensity} color={color} castShadow />;
}

export interface CodexSetProps {
  /** Height of the paper. */
  groundY?: number;
  /** Centre (x, z) and size (w, d) of the study sheet lying on the desk. */
  sheet?: { cx: number; cz: number; w: number; d: number };
  /** Ink construction ellipse on the sheet, radius in scene units; 0 hides it. */
  circle?: number;
  /** Radius of the construction ellipse centre (x, z). Defaults to the sheet centre. */
  circleCenter?: [number, number];
}

/**
 * The expert's codex stage: a warm-lit study sheet of brown parchment lying on the (HTML) paper page, with an ink
 * construction ellipse and cast shadows drawn as iron-gall hatching. The canvas stays transparent so the page's own
 * parchment shows around the sheet and UI and 3D share one paper.
 */
export function CodexSet({ groundY = -0.55, sheet = { cx: 0, cz: -0.55, w: 5.6, d: 3.8 }, circle = 1.5, circleCenter }: CodexSetProps) {
  const s = useStageColors();
  const tex = useMemo(() => getParchmentTexture({ width: 1400, height: 950, tone: '#E9D3A4', seed: 11, vignette: true, border: true, grid: 58 }), []);
  const paper = useMemo(() => new MeshBasicMaterial({ map: tex as CanvasTexture }), [tex]);
  const edge = useMemo(() => new MeshBasicMaterial({ color: new Color('#B89A68') }), []);
  const shadowMat = useMemo(() => createHatchedShadowMaterial(s.ink, 0.62, 5), [s.ink]);
  const under = useMemo(() => new MeshBasicMaterial({ color: '#6B4A28', transparent: true, opacity: 0.22, depthWrite: false }), []);
  useEffect(
    () => () => {
      paper.dispose();
      edge.dispose();
      shadowMat.dispose();
      under.dispose();
    },
    [paper, edge, shadowMat, under],
  );
  const cc = circleCenter ?? [sheet.cx, sheet.cz];
  const circlePts = useMemo(() => {
    const pts: number[] = [];
    for (let i = 0; i <= 160; i++) {
      // A slightly wobbly hand-drawn circle, drawn twice with an offset like a quick pen stroke.
      const a = (i / 160) * Math.PI * 2;
      const rr = circle * (1 + 0.012 * Math.sin(a * 3 + 0.4));
      pts.push(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    }
    return new Float32Array(pts);
  }, [circle]);
  const thick = 0.03;
  return (
    <>
      <hemisphereLight args={[s.skyLight, s.groundLight, 1.35]} />
      <KeyLight />
      <directionalLight position={[3, 2.4, -1.5]} intensity={0.45} color="#FFE9C8" />
      <CastShadows />
      {/* soft contact shade of the sheet on the page */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[sheet.cx + 0.06, groundY - thick - 0.002, sheet.cz + 0.08]} material={under} userData={{ noCast: true, noReceive: true }}>
        <planeGeometry args={[sheet.w + 0.22, sheet.d + 0.22]} />
      </mesh>
      <mesh position={[sheet.cx, groundY - thick / 2, sheet.cz]} material={edge} userData={{ noCast: true, noReceive: true }}>
        <boxGeometry args={[sheet.w, thick, sheet.d]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[sheet.cx, groundY + 0.001, sheet.cz]} material={paper} userData={{ noCast: true, noReceive: true }}>
        <planeGeometry args={[sheet.w, sheet.d]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[sheet.cx, groundY + 0.004, sheet.cz]} material={shadowMat} userData={{ noCast: true, receive: true }} receiveShadow>
        <planeGeometry args={[sheet.w, sheet.d]} />
      </mesh>
      {circle > 0 && (
        <lineLoop position={[cc[0], groundY + 0.006, cc[1]]} userData={{ noCast: true }}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[circlePts, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={s.ink} transparent opacity={0.7} />
        </lineLoop>
      )}
    </>
  );
}
