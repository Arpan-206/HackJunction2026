import { useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3, type Group, type Mesh } from 'three';
import { Link } from 'react-router-dom';
import { HandCanvas, Hand, synthFrame, type HandHandle, type StageProps } from '../three';
import { useStageColors } from '../three/stageContext';
import type { MotionSpec } from '../api';
import { ThemeSwitch } from '../components/ThemeSelect';

/** One clip for both cards. */
export const CARD_MOTION: MotionSpec = { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5, 4, 3, 2], beat_ms: 700 };
/**
 * First-person view of a hand resting on a desk: the camera sits behind and above the wrist (20 degrees off the hand's
 * long axis, so the fingers run diagonally up the frame) and looks down at 55 degrees along the back of the hand, with
 * the fingertips farthest away. Aimed at the middle of the column between bench and hand. The bench top sits 0.04
 * under the lowest point of the skinned mesh over its whole motion (mesh minimum y = -1.036 at the hand's origin
 * height, probed over 45 s), so a pressing fingertip stops just above the wood.
 */
export const CARD_GROUND_Y = -1.08;
export const CARD_AIM_Y = -0.6;
export const CARD_RADIUS = 1.25;
export const CARD_DISTANCE = 5.8;
export const CARD_AZIMUTH = (20 * Math.PI) / 180;
export const CARD_ELEVATION = (55 * Math.PI) / 180;
export const CARD_CAMERA: [number, number, number] = [
  CARD_DISTANCE * Math.sin(CARD_AZIMUTH) * Math.cos(CARD_ELEVATION),
  CARD_AIM_Y + CARD_DISTANCE * Math.sin(CARD_ELEVATION),
  CARD_DISTANCE * Math.cos(CARD_AZIMUTH) * Math.cos(CARD_ELEVATION),
];
export const CARD_STAGE: StageProps = {
  controls: 'none',
  groundY: CARD_GROUND_Y,
  showCircle: false,
  circleCenter: [0, 0],
  circleRadius: CARD_RADIUS,
  shadowSize: [2.4, 2.6],
  cameraPosition: CARD_CAMERA,
};

/**
 * The cards on this screen orbit: drag a card's stage to turn round the hand, aimed at the middle of the column between
 * bench and hand, where the fixed card camera has always looked. A card is a link, so a press that turns the view does
 * not open it (HandCanvas); the view glides back when the mouse leaves the card, since a Reset view button cannot sit
 * inside a link.
 */
const ROLE_CARD_STAGE: StageProps = { ...CARD_STAGE, controls: 'orbit', target: [0, CARD_AIM_Y, 0] };

/**
 * One time source for both cards. Each canvas has its own clock (it starts when that canvas mounts and stops while it
 * is scrolled out of view), so a clock per canvas would put the two hands in different phases. The wall clock is shared
 * by both canvases, by remounts and by tab switches, so the hands stay locked frame for frame.
 */
export const cardTime = () => performance.now() / 1000;
const cardFrame = () => synthFrame(CARD_MOTION, cardTime(), 'right');

/** The slow turntable sway, on the shared clock instead of the canvas clock (`time` lets the dev camera view pause it). */
export function CardSway({ children, time = cardTime }: { children: ReactNode; time?: () => number }) {
  const g = useRef<Group>(null);
  useFrame(() => {
    if (g.current) g.current.rotation.y = Math.sin(time() * 0.25) * 0.12;
  });
  return <group ref={g}>{children}</group>;
}

/** The card's construction circle, drawn in the theme's ink on the paper. */
export function CardRing() {
  const s = useStageColors();
  const pts = useMemo(() => {
    const a: number[] = [];
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * Math.PI * 2;
      a.push(Math.cos(t) * CARD_RADIUS, 0, Math.sin(t) * CARD_RADIUS);
    }
    return new Float32Array(a);
  }, []);
  return (
    <lineLoop position={[0, CARD_GROUND_Y + 0.002, 0]}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pts, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={s.ink} transparent opacity={0.4} />
    </lineLoop>
  );
}

/**
 * Marionette strings for the wooden hand: one fine thread from each fingertip and one from the back of the wrist,
 * rising straight up and out of the top of the frame. Nothing is drawn where they end. Thin cylinders rather than GL
 * lines so the width is the same on every browser and screen. Each frame the thread is moved to its bone. The thread
 * colour is the theme's, so it reads on the page behind it.
 */
const STRING_RADIUS = 0.0035;
const STRING_TOP_Y = 4;
const STRING_COUNT = 6;

export function HandStrings({ hand }: { hand: RefObject<HandHandle | null> }) {
  const s = useStageColors();
  const threads = useRef<(Mesh | null)[]>([]);
  const at = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const h = hand.current;
    if (!h) return;
    const { rig } = h;
    for (let i = 0; i < STRING_COUNT; i++) {
      const m = threads.current[i];
      if (!m) continue;
      if (i < 5) rig.fingers[i].tip.getWorldPosition(at);
      else rig.root.localToWorld(at.copy(rig.wristBack));
      const len = Math.max(STRING_TOP_Y - at.y, 0.01);
      m.visible = true;
      m.position.set(at.x, at.y + len / 2, at.z);
      m.scale.set(1, len, 1);
    }
  });
  return (
    <group>
      {Array.from({ length: STRING_COUNT }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            threads.current[i] = m;
          }}
          visible={false}
        >
          <cylinderGeometry args={[STRING_RADIUS, STRING_RADIUS, 1, 5, 1]} />
          <meshBasicMaterial color={s.thread} transparent opacity={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function Arrow() {
  return (
    <svg width="28" height="14" viewBox="0 0 28 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M0 7h25M19 1l7 6-7 6" />
    </svg>
  );
}

/** First screen: choose Expert or Apprentice, each with a live 3D hand. */
export function RoleSelect() {
  const apprenticeHand = useRef<HandHandle>(null);
  return (
    <div className="roles">
      <header className="roles__head">
        <h1 className="roles__brand">Geppetto</h1>
        <figure className="roles__quote">
          <blockquote className="roles__motto">
            &ldquo;Begin to submit yourself to the direction of a master for instruction as early as you can; and do not leave
            the master until you have to.&rdquo;
          </blockquote>
          <figcaption className="roles__cite">Cennino Cennini, Il Libro dell&rsquo;Arte, chapter III</figcaption>
        </figure>
      </header>

      <main className="roles__stage" id="main">
        <Link to="/expert" className="role" draggable={false}>
          <div className="role__stage">
            <HandCanvas preset="closeup" stage={ROLE_CARD_STAGE} resetView="leave">
              <CardRing />
              <CardSway>
                <Hand side="right" style="chalk" getFrame={cardFrame} smoothing={false} rotation={[0, 0.1, 0]} />
              </CardSway>
            </HandCanvas>
          </div>
          <div className="role__plate">
            <span className="role__title">I am an Expert</span>
            <span className="role__desc">Record a skill once with your gloves, shape it into steps, and let learners train against your hand.</span>
            <span className="role__cta">
              Enter the studio <Arrow />
            </span>
          </div>
        </Link>

        <div className="roles__between" aria-hidden="true">
          <svg viewBox="0 0 60 120" fill="none" stroke="currentColor" strokeWidth="1.2">
            <circle cx="30" cy="60" r="26" />
            <rect x="8" y="38" width="44" height="44" />
            <path d="M30 0v34M30 86v34" />
          </svg>
        </div>

        <Link to="/apprentice" className="role" draggable={false}>
          <div className="role__stage">
            <HandCanvas preset="closeup" stage={ROLE_CARD_STAGE} resetView="leave">
              <CardRing />
              <CardSway>
                <Hand ref={apprenticeHand} side="right" style="wood" getFrame={cardFrame} smoothing={false} rotation={[0, 0.1, 0]} />
              </CardSway>
              <HandStrings hand={apprenticeHand} />
            </HandCanvas>
          </div>
          <div className="role__plate">
            <span className="role__title">I am an Apprentice</span>
            <span className="role__desc">Follow the expert&rsquo;s hand, see exactly which finger is wrong, and watch your score climb.</span>
            <span className="role__cta">
              Begin learning <Arrow />
            </span>
          </div>
        </Link>
      </main>

      <footer className="roles__foot">
        <span>Junction 2026 &middot; Rokoko Smartgloves</span>
        <ThemeSwitch />
      </footer>
    </div>
  );
}
