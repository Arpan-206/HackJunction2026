import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { Environment, useGLTF } from '@react-three/drei';
import { Color, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { createGoldLeafMaterial, getWalnutTextures } from './surfaces';
import type { StageColors } from '../theme/themes';

/** Render budget for the set dressing. 'low' skips the still-life props; 'high' adds them. */
export type StageQuality = 'low' | 'high';

/** Renders nothing if any child (a model or texture) fails to load, so decoration can never break a scene. */
export class Optional extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    /* a missing asset only costs the prop */
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function luminance(css: string): number {
  const c = new Color(css);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Warm workshop image-based light: low intensity, never drawn as the background. Dimmer on dark themes. */
export function WorkshopLight({ stage }: { stage: StageColors }) {
  const intensity = luminance(stage.background) > 0.25 ? 0.5 : 0.3;
  return (
    <Optional>
      <Suspense fallback={null}>
        <Environment files="/textures/hdri/artist_workshop_1k.hdr" background={false} environmentIntensity={intensity} />
      </Suspense>
    </Optional>
  );
}

/**
 * Pale limed oak bench top (walnut grain washed light) whose top face sits at `y`, centred at (cx, cz), with a front lip.
 * The shadow theatre stands its lamp on it; the hand stages draw on the sketchbook sheet instead (sketchbook.tsx).
 */
export function Workbench({ y, cx, cz, width, depth }: { y: number; cx: number; cz: number; width: number; depth: number }) {
  const tex = getWalnutTextures([width / 2.2, depth / 2.2]);
  const mat = useMemo(() => {
    const m = new MeshStandardMaterial({ color: '#ffffff', map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.roughnessMap, roughness: 1, metalness: 0 });
    const lime = new Color('#efe4d0');
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${lime.r}, ${lime.g}, ${lime.b}), 0.42);`,
      );
    };
    return m;
  }, [tex]);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <group position={[cx, y, cz]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={mat}>
        <planeGeometry args={[width, depth]} />
      </mesh>
      <mesh position={[0, -0.09, depth / 2]} material={mat}>
        <boxGeometry args={[width, 0.18, 0.01]} />
      </mesh>
    </group>
  );
}

const MODELS = {
  bust: '/models/marble_bust_01/marble_bust_01.gltf',
  lamp: '/models/vintage_oil_lamp/vintage_oil_lamp.gltf',
} as const;

interface PropProps {
  url: string;
  position: [number, number, number];
  rotationY?: number;
  scale?: number;
  /** Multiplies the albedo so the prop stays low contrast. */
  dim?: number;
}

/** Loads a glTF, clones it per use and dims its materials so props stay out of the hands' way. */
function Prop({ url, position, rotationY = 0, scale = 1, dim = 1 }: PropProps) {
  const { scene } = useGLTF(url);
  const obj = useMemo<Object3D>(() => {
    const c = scene.clone(true);
    c.traverse((o) => {
      if (o instanceof Mesh) {
        const m = (o.material as MeshStandardMaterial).clone();
        if (dim !== 1 && m.color) m.color.multiplyScalar(dim);
        o.material = m;
      }
    });
    return c;
  }, [scene, dim]);
  useEffect(
    () => () =>
      obj.traverse((o) => {
        if (o instanceof Mesh) (o.material as MeshStandardMaterial).dispose();
      }),
    [obj],
  );
  return <primitive object={obj} position={position} rotation={[0, rotationY, 0]} scale={scale} />;
}

/**
 * Still-life models at the back of the study sheet: a marble bust (left) and an oil lamp (right), the things a
 * Renaissance notebook page would be drawn from. Each loads lazily and independently, and silently drops out if its
 * model fails.
 */
export function BackdropProps({ y, cx, backZ, halfWidth }: { y: number; cx: number; backZ: number; halfWidth: number }) {
  const x = Math.min(halfWidth, 2.6);
  return (
    <>
      <Optional>
        <Suspense fallback={null}>
          <Prop url={MODELS.bust} position={[cx - x, y, backZ + 0.35]} rotationY={0.5} scale={1.9} dim={0.8} />
        </Suspense>
      </Optional>
      <Optional>
        <Suspense fallback={null}>
          <Prop url={MODELS.lamp} position={[cx + x, y, backZ + 0.3]} rotationY={-0.4} scale={1.3} dim={0.9} />
        </Suspense>
      </Optional>
    </>
  );
}

/** A small gold-leaf disc for mastery accents (for example the guild seal). Drop into any canvas. */
export function GoldSeal({ radius = 0.2, position = [0, 0, 0] as [number, number, number] }: { radius?: number; position?: [number, number, number] }) {
  const mat = useMemo(() => createGoldLeafMaterial(), []);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} material={mat}>
      <cylinderGeometry args={[radius, radius, radius * 0.18, 48]} />
    </mesh>
  );
}
