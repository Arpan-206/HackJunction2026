import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, SpotLight, Vector3, type Material } from 'three';
import type { Side } from '../api/types';
import { Optional, Workbench } from './atmosphere';
import { useStageColors } from './stageContext';
import { getPlasterTextures } from './surfaces';

/**
 * The shadow-puppet theatre: a dim room, a lime-plaster wall and the oil lamp on the bench in front of it. A spot light at
 * the lamp's flame throws every hand that casts shadows onto the wall, big and crisp enough to read from 3 m. Hands are
 * placed between the lamp and the wall by `puppetLayout`; any hand mesh works, since `useCastShadows` only switches
 * `castShadow` on for the meshes under a group.
 */

/** Plane of the plaster wall (z). */
export const WALL_Z = -2.7;
/** The lamp's flame, where the light sits. */
export const LAMP_POS: [number, number, number] = [0, -0.62, 2.45];
/** Height and depth of the hands between the lamp and the wall. */
export const PUPPET_Y = -0.05;
export const PUPPET_Z = 0.75;
/** How far either side of the lamp the expert's and the learner's hands sit. */
export const PUPPET_X = 0.62;
/** Hand scale in the theatre (a hand is about two scene units long at scale 1). */
export const PUPPET_SCALE = 0.4;
/** Camera framing: above the lamp, looking past the hands at the wall. */
export const THEATRE_CAMERA: [number, number, number] = [0, 1.25, 8.4];
export const THEATRE_TARGET: [number, number, number] = [0, 0.55, -1.5];
/**
 * The part of the wall (scene units on the wall plane) the theatre camera shows clear of the shape's name above and the
 * bench below, with a small margin at the sides. Every shadow's fingers stay inside it for the whole rep (tested).
 */
export const WALL_VIEW = { left: -3.9, right: 3.9, bottom: -0.9, top: 2.45 };

const LAMP_URL = '/models/vintage_oil_lamp/vintage_oil_lamp.gltf';
/** Height of the lamp model's flame above its base, in model units. */
const LAMP_FLAME_Y = 0.5;
const LAMP_SCALE = 1.15;
const FLAME = '#ffcf7a';

/** Where a point between the lamp and the wall lands on the wall, and how much the shadow is magnified there. */
export function projectToWall(p: Vector3, out: Vector3): Vector3 {
  const k = (WALL_Z - LAMP_POS[2]) / (p.z - LAMP_POS[2]);
  return out.set(LAMP_POS[0] + (p.x - LAMP_POS[0]) * k, LAMP_POS[1] + (p.y - LAMP_POS[1]) * k, WALL_Z + 0.02);
}

/** Shadow magnification for something at depth z. */
export const wallMagnification = (z: number): number => (WALL_Z - LAMP_POS[2]) / (z - LAMP_POS[2]);

/* ---------- puppet layouts ---------- */

/** How the hands of one puppet are arranged: one hand in profile, two as wings, or the snail's shell on its body. */
export type PuppetLayout = 'right' | 'left' | 'wings' | 'snail';

export interface HandPlacement {
  side: Side;
  /** Tilt of the whole hand about the wall's normal (radians), so ears point up and wings lift. */
  tilt: number;
  /** Wrist position relative to the puppet's anchor, in scene units. */
  position: [number, number, number];
  /** Hand rotation inside the tilt: turns the fingers sideways so the lamp sees the hand in profile. */
  rotation: [number, number, number];
  scale: number;
}

const QUARTER = Math.PI / 2;
/** How far a one-handed puppet is raised: "straight" fingers keep a relaxed bend, so ears only stand up with a good lift. */
const RAISE = 1.0;

/**
 * The hands of a puppet in profile to the lamp, so finger curls show in the silhouette. Fingers run along -z at rest; a
 * quarter turn about y lays them sideways along the wall. One hand points its fingers away from the wrist, raised a little;
 * wings cross at the wrists and spread outwards; the snail rests a fist (the shell) on the feelers hand.
 */
export function puppetLayout(layout: PuppetLayout, s = PUPPET_SCALE, raise = RAISE): HandPlacement[] {
  const reach = 0.95 * s;
  switch (layout) {
    case 'left':
      return [{ side: 'left', tilt: raise, position: [-reach, 0, 0], rotation: [0, -QUARTER, 0], scale: s }];
    case 'wings': {
      const w = s * 0.7;
      return [
        { side: 'right', tilt: 0.4, position: [-0.12 * w, 0, 0], rotation: [0, -QUARTER, 0], scale: w },
        { side: 'left', tilt: -0.4, position: [0.12 * w, 0, 0.04], rotation: [0, QUARTER, 0], scale: w },
      ];
    }
    case 'snail':
      return [
        { side: 'right', tilt: -0.3, position: [reach, -0.35 * s, 0], rotation: [0, QUARTER, 0], scale: s },
        { side: 'left', tilt: -0.7, position: [1.3 * s, 0.35 * s, 0.08], rotation: [0, QUARTER, 0], scale: s * 0.9 },
      ];
    default:
      return [{ side: 'right', tilt: -raise, position: [reach, 0, 0], rotation: [0, QUARTER, 0], scale: s }];
  }
}

/** How far each one-handed puppet is raised: the dog's snout stays near level, the swan's neck stands tall. */
const RAISE_BY_MOVE: Record<string, number> = { sp_rabbit: 1.25, sp_talking_dog: 0.55, sp_swan: 1.5 };

/** The lift a move's one-handed puppet needs. */
export const raiseFor = (moveId: string | null | undefined): number => (moveId ? RAISE_BY_MOVE[moveId] : undefined) ?? RAISE;

/** The layout a move needs: the bird and the snail by name, any other two-handed move as wings, else one hand. */
export function layoutFor(moveId: string | null | undefined, hands: Side | 'both'): PuppetLayout {
  if (moveId === 'sp_snail') return 'snail';
  if (hands === 'both') return 'wings';
  return hands === 'left' ? 'left' : 'right';
}

/* ---------- shadow casting ---------- */

/**
 * Makes every mesh under `group` cast a shadow, re-checked a few times a second so a hand rebuilt (a new style, a glTF hand
 * loaded late) joins in. Nothing else in the theatre casts, so the wall shows only hands.
 */
export function useCastShadows(group: RefObject<Object3D>) {
  const tick = useRef(0);
  useFrame(() => {
    if (tick.current++ % 12 !== 0) return;
    group.current?.traverse((o) => {
      if ((o as Mesh).isMesh && o.userData.noCast !== true) o.castShadow = true;
    });
  });
}

/** A group whose meshes all cast shadows on the wall. */
export function Caster({ children, position }: { children: ReactNode; position?: [number, number, number] }) {
  const g = useRef<Group>(null);
  useCastShadows(g);
  return (
    <group ref={g} position={position}>
      {children}
    </group>
  );
}

/** One puppet: its hands placed by a layout at `x` between the lamp and the wall, every mesh casting a shadow. */
export function Puppet({ x, placements, children }: { x: number; placements: HandPlacement[]; children: (p: HandPlacement) => ReactNode }) {
  return (
    <Caster position={[x, PUPPET_Y, PUPPET_Z]}>
      {placements.map((p) => (
        <group key={p.side} rotation={[0, 0, p.tilt]}>
          {children(p)}
        </group>
      ))}
    </Caster>
  );
}

/* ---------- the set ---------- */

function CameraAim({ target }: { target: [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    camera.lookAt(...target);
    camera.updateProjectionMatrix();
  }, [camera, target]);
  return null;
}

function TheatreWall() {
  const tex = getPlasterTextures([4, 2]);
  const mat = useMemo(() => {
    const m = new MeshStandardMaterial({ color: '#efe2c6', normalMap: tex.normalMap, roughnessMap: tex.roughnessMap, roughness: 1, metalness: 0 });
    m.normalScale.set(0.3, 0.3);
    return m;
  }, [tex]);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh position={[0, 1.2, WALL_Z]} material={mat} receiveShadow>
      <planeGeometry args={[18, 9]} />
    </mesh>
  );
}

function Lamp() {
  const { scene } = useGLTF(LAMP_URL);
  const obj = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => {
      if (!(o as Mesh).isMesh) return;
      const m = o as Mesh;
      m.castShadow = false;
      m.userData.noCast = true;
      const mat = (m.material as MeshStandardMaterial).clone();
      // The flame lights the room, not its own lamp: a warm glow keeps the brass and glass readable in the dark.
      if (mat.emissive) {
        mat.emissive = new Color('#8a5a24');
        mat.emissiveIntensity = 0.55;
      }
      m.material = mat;
    });
    return c;
  }, [scene]);
  useEffect(
    () => () =>
      obj.traverse((o) => {
        if ((o as Mesh).isMesh) ((o as Mesh).material as Material).dispose();
      }),
    [obj],
  );
  return <primitive object={obj} position={[LAMP_POS[0], LAMP_POS[1] - LAMP_FLAME_Y * LAMP_SCALE, LAMP_POS[2]]} scale={LAMP_SCALE} />;
}

/** The light at the flame: a spot aimed at the wall, with a crisp shadow map sized for the puppets. */
function LampLight({ intensity }: { intensity: number }) {
  const light = useRef<SpotLight>(null);
  const aim = useMemo(() => {
    const o = new Object3D();
    o.position.set(0, 1.1, WALL_Z);
    return o;
  }, []);
  useLayoutEffect(() => {
    const l = light.current;
    if (!l) return;
    l.target = aim;
    l.shadow.mapSize.set(2048, 2048);
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.015;
    l.shadow.camera.near = 0.4;
    l.shadow.camera.far = 12;
    l.shadow.camera.updateProjectionMatrix();
  }, [aim]);
  return (
    <>
      <primitive object={aim} />
      <spotLight ref={light} position={LAMP_POS} color="#ffd9a0" intensity={intensity} angle={0.64} penumbra={0.6} decay={1.4} distance={0} castShadow />
    </>
  );
}

function Flame() {
  const mat = useMemo(() => new MeshBasicMaterial({ color: new Color(FLAME), transparent: true, opacity: 0.9, depthWrite: false }), []);
  const halo = useMemo(() => new MeshBasicMaterial({ color: new Color(FLAME), transparent: true, opacity: 0.16, depthWrite: false }), []);
  const flame = useRef<Mesh>(null);
  useEffect(
    () => () => {
      mat.dispose();
      halo.dispose();
    },
    [mat, halo],
  );
  useFrame(({ clock }) => {
    const f = flame.current;
    if (f) f.scale.set(1, 1 + Math.sin(clock.elapsedTime * 9) * 0.06 + Math.sin(clock.elapsedTime * 23) * 0.03, 1);
  });
  return (
    <group position={LAMP_POS} userData={{ noCast: true }}>
      <mesh ref={flame} material={mat} position={[0, 0.03, 0]} userData={{ noCast: true }}>
        <sphereGeometry args={[0.035, 12, 10]} />
      </mesh>
      <mesh material={halo} userData={{ noCast: true }}>
        <sphereGeometry args={[0.16, 16, 12]} />
      </mesh>
    </group>
  );
}

export interface ShadowTheatreSetProps {
  /** Lamp brightness. Default 55. */
  intensity?: number;
  /** Ambient fill of the dim room, 0..1. Default 0.18. */
  fill?: number;
}

/** The theatre without the hands: room, wall, bench, lamp and its light. Use inside a bare, shadowed HandCanvas. */
export function ShadowTheatreSet({ intensity = 55, fill = 0.18 }: ShadowTheatreSetProps) {
  const s = useStageColors();
  return (
    <>
      <color attach="background" args={['#1b140e']} />
      <CameraAim target={THEATRE_TARGET} />
      <hemisphereLight args={[s.skyLight, '#2a1d12', fill]} />
      <LampLight intensity={intensity} />
      <Flame />
      <Optional>
        <Suspense fallback={null}>
          <TheatreWall />
          <Workbench y={LAMP_POS[1] - LAMP_FLAME_Y * LAMP_SCALE} cx={0} cz={(LAMP_POS[2] + WALL_Z) / 2 + 0.6} width={18} depth={LAMP_POS[2] - WALL_Z + 2.2} />
        </Suspense>
      </Optional>
      <Optional>
        <Suspense fallback={null}>
          <Lamp />
        </Suspense>
      </Optional>
    </>
  );
}

useGLTF.preload(LAMP_URL);
