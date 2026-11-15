import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MeshBasicMaterial, TorusGeometry, type Mesh } from 'three';
import type { HandFrame, Side } from '../../../api';
import { HAND_FLOOR_Y, Hand, HandCanvas, KeysSketch, RacketSketch, useStageColors, type HandHandle, type HandStyle, type StillStage } from '../../../three';
import type { SkillScene } from './catalogue';

/**
 * The first-person view of a skill: the camera sits behind and above the wrist and looks forward and down along the back of
 * the hand, the way you see your own hand on a desk. The forearm comes in from the bottom corner, the fingers point away and
 * a little across the frame, and the hand rests just above the bench over its chalk circle. The hand keeps the position the
 * lesson stages give it (wrist at the origin, fingers along -z, so it is not centred on the ring the way a bare hand is) so the
 * chalk racket and keys sit exactly where they do in training; only the camera moves: it aims at the middle of the hand's
 * sweep, so the hand, and the ring under it, sit in the middle of the frame.
 */
const VIEW_AZIMUTH = (22 * Math.PI) / 180;
const VIEW_ELEVATION = (58 * Math.PI) / 180;

interface SceneView {
  /** Where the camera looks: the middle of the hand, a little above the bench. */
  aim: [number, number, number];
  distance: number;
  /** Bench top: just below the lowest point the hand reaches in its pose. */
  groundY: number;
  /**
   * The chalk circle under the hand, or 'under-aim': the circle sits where the line from the camera through the aim point meets the
   * bench, so on screen it is centred on the subject (the hand floats above the bench, and the camera looks down on it).
   */
  circle: [number, number] | 'under-aim';
  radius: number;
  /** Extra turn of the whole hand (and anything it holds), radians: the letter hand stands up, the racket tilts its face. */
  handRotation?: [number, number, number];
  handPosition?: [number, number, number];
  /** Camera round from straight behind, radians; positive comes from the little finger side. Default VIEW_AZIMUTH. */
  azimuth?: number;
  /** Camera height above the aim, radians. Default VIEW_ELEVATION. */
  elevation?: number;
}

const VIEWS: Record<SkillScene, SceneView> = {
  // The grip from the thumb side and a little above: the handle in the palm, the thumb on the blade, the blade out past the
  // fingers. Framed for the whole forehand stroke of the hover preview, not just the held grip.
  racket: { aim: [-0.65, -0.85, -1.09], distance: 6.8, groundY: -1.3, circle: 'under-aim', radius: 1.7, azimuth: (-72 * Math.PI) / 180, elevation: (30 * Math.PI) / 180 },
  keys: { aim: [-0.115, -0.26, -1.06], distance: 3.9, groundY: HAND_FLOOR_Y, circle: 'under-aim', radius: 1.3 },
  // The raised hand seen almost level from behind, far enough back that a raised finger never looms or leaves the frame.
  letter: { aim: [0, 0.38, -0.3], distance: 5.6, groundY: -0.62, circle: [0, -0.35], radius: 1.1, handRotation: [1.25, 0, 0], handPosition: [0, -0.35, 0.2], elevation: (30 * Math.PI) / 180 },
};

function cameraFor(v: SceneView): [number, number, number] {
  const az = v.azimuth ?? VIEW_AZIMUTH;
  const el = v.elevation ?? VIEW_ELEVATION;
  return [
    v.aim[0] + v.distance * Math.sin(az) * Math.cos(el),
    v.aim[1] + v.distance * Math.sin(el),
    v.aim[2] + v.distance * Math.cos(az) * Math.cos(el),
  ];
}

/** The camera and bench of a skill's first-person view, for a still picture (HandStill) or a live stage. */
export function sceneStage(scene: SkillScene): Required<Pick<StillStage, 'cameraPosition' | 'target' | 'groundY' | 'circleCenter' | 'circleRadius' | 'shadowSize'>> {
  const v = VIEWS[scene];
  const cam = cameraFor(v);
  let circle: [number, number];
  if (v.circle === 'under-aim') {
    // The ray from the camera through the aim point, followed down to the bench.
    const k = (cam[1] - v.groundY) / (cam[1] - v.aim[1]);
    circle = [cam[0] + (v.aim[0] - cam[0]) * k, cam[2] + (v.aim[2] - cam[2]) * k];
  } else circle = v.circle;
  return {
    cameraPosition: cam,
    target: v.aim,
    groundY: v.groundY,
    circleCenter: circle,
    circleRadius: v.radius,
    shadowSize: [v.radius * 1.6, v.radius * 1.8],
  };
}

/** A chalk ring for the ball, turned to face the camera. */
function ChalkBall({ position }: { position: [number, number, number] }) {
  const stage = useStageColors();
  const mat = useMemo(() => new MeshBasicMaterial({ color: stage.chalk, transparent: true, opacity: 0.9, depthWrite: false }), [stage.chalk]);
  const geo = useMemo(() => new TorusGeometry(0.15, 0.03, 6, 40), []);
  useEffect(
    () => () => {
      mat.dispose();
      geo.dispose();
    },
    [mat, geo],
  );
  const ring = useRef<Mesh>(null);
  useFrame(({ camera }) => {
    if (ring.current) ring.current.quaternion.copy(camera.quaternion);
  });
  return <mesh ref={ring} position={position} geometry={geo} material={mat} renderOrder={5} userData={{ noCast: true }} />;
}

/** Keys drawn on the bench: the sketch's top line sits a hair above the bench top. */
const KEYS_LIFT = 0.006;
const KEYS_TOP_OFFSET = 0.052;

interface SkillSetProps {
  scene: SkillScene;
  side?: Side;
  style?: HandStyle;
  /** A held frame (a still picture) or a per-frame source (a live showcase). */
  frame?: HandFrame | null;
  getFrame?: (t: number) => HandFrame | null;
}

/**
 * The hand of a skill with its chalk stand-ins: the racket outline in the hand and a ball in front of it, the keys drawn on
 * the bench under the fingertips, or the hand alone holding a letter. Props stay off, so this is what every learner sees.
 */
export function SkillSet({ scene, side = 'right', style = 'chalk', frame, getFrame }: SkillSetProps) {
  const hand = useRef<HandHandle>(null);
  const v = VIEWS[scene];
  return (
    <>
      <Hand centred={false} ref={hand} side={side} style={style} frame={frame} getFrame={getFrame} smoothing={getFrame ? undefined : false} rotation={v.handRotation} position={v.handPosition}>
        {scene === 'racket' && <RacketSketch weight={2.4} />}
      </Hand>
      {scene === 'racket' && <ChalkBall position={[-1.15, 0.05, -2.2]} />}
      {scene === 'keys' && <KeysSketch keys={11} y={v.groundY + KEYS_LIFT - KEYS_TOP_OFFSET} handRef={hand} />}
    </>
  );
}

/** A fixed camera (controls 'none') looks at the world origin; aim it at the scene instead, as the still renderer does. */
function LookAt({ target }: { target: [number, number, number] }) {
  const camera = useThree((st) => st.camera);
  const [x, y, z] = target;
  useLayoutEffect(() => {
    camera.lookAt(x, y, z);
    camera.updateMatrixWorld();
  }, [camera, x, y, z]);
  return null;
}

interface SkillLiveProps {
  scene: SkillScene;
  getFrame: (t: number) => HandFrame | null;
  side?: Side;
  label: string;
  /** Let the learner turn the view a little (the skill page); off for a card, which keeps the still's exact framing. */
  orbit?: boolean;
  className?: string;
}

/** The same first-person scene as the still, playing: the skill page showcase and a card's hover preview. */
export function SkillLive({ scene, getFrame, side = 'right', label, orbit = false, className }: SkillLiveProps) {
  const st = useMemo(() => sceneStage(scene), [scene]);
  return (
    <HandCanvas
      className={className}
      preset="single"
      label={label}
      stage={{ ...st, controls: orbit ? 'orbit' : 'none', decor: true, ...(orbit ? {} : { quality: 'low' as const }) }}
    >
      {!orbit && <LookAt target={st.target} />}
      <SkillSet scene={scene} side={side} getFrame={getFrame} />
    </HandCanvas>
  );
}
