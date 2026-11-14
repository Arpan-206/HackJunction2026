import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Group, Material, Mesh, Vector3, type InstancedInterleavedBuffer } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { FINGERS } from '../../../../api/types';
import { Hand, HandCanvas, Keyboard, PropCue, Racket, RacketSketch, STRING_POINTS, useStageColors, useStageOrbit, writeStringSegments, type HandHandle, type OrbitView, type StageProps } from '../../../../three';
import { FaultMarks } from '../modes/FaultMarks';
import { LearnerHand } from '../modes/LearnerHand';
import { Crossbar } from '../modes/Strings';
import type { ModeProps } from '../modes/types';
import { FingerTinter } from '../modes/useFingerTints';

/** Length of the "Try it out" change: strings lift away, the expert floats down, the ghost settles over your hand. */
export const TRANSITION_MS = 1300;
/** How far above its resting place the expert's hand hangs while it works the puppet. */
const PUPPETEER_LIFT = 1.2;
/** Height above the wooden hand the ghost floats down from. */
const GHOST_FALL = 1.4;

/**
 * The role cards' first-person camera (start screen): behind and above the wrist, 20 degrees off the hand's long axis,
 * looking down at 55 degrees. Watching frames the puppeteer and puppet together from a little lower and further back.
 */
const AIM_Y = -0.5;
/** How much higher the watching frame aims: the middle of the puppet, the expert and the crossbar. */
const WATCH_RAISE = 0.85;
const GROUND_Y = -1.08;
function cardCamera(distance: number, elevationDeg: number, aimY: number): Vector3 {
  const az = (20 * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return new Vector3(distance * Math.sin(az) * Math.cos(el), aimY + distance * Math.sin(el), distance * Math.cos(az) * Math.cos(el));
}
const STAGE: StageProps = { controls: 'orbit', groundY: GROUND_Y, showCircle: false, circleCenter: [0, 0], circleRadius: 1.25, shadowSize: [2.4, 2.6], cameraPosition: [1.7, 4.2, 3.2], target: [0, AIM_Y, 0] };

const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 0 while watching, 1 once trying, and the eased way between while the change plays. */
function progressOf(phase: 'watch' | 'try', transitionAt: number | null): number {
  if (transitionAt !== null) return clamp01((performance.now() - transitionAt) / TRANSITION_MS);
  return phase === 'try' ? 1 : 0;
}

export interface PracticeStageProps extends ModeProps {
  phase: 'watch' | 'try';
  /** performance.now() when "Try it out" was pressed, while the change plays; null otherwise. */
  transitionAt: number | null;
  /** The expert's video, docked in the expert's panel; null when the step has none. */
  video?: ReactNode;
}

/**
 * The practice stage: two panels side by side (stacked on a phone). Watching, the expert's chalk hand works a wooden puppet
 * on strings, frame for frame the same, beside your own live hand alone. Trying, the expert's hand plays alone on the left
 * and its ghost lies over your hand on the right, with the live corrections. "Try it out" plays the change between them.
 */
export function PracticeStage({ coach, gloves, side, prop, cue, policy, toleranceDeg, phase, transitionAt, video }: PracticeStageProps) {
  const progress = () => progressOf(phase, transitionAt);
  const expertAway = phase === 'try' && !policy.showMaster;
  return (
    <div className="ap-practice">
      <figure className="ap-practice__pane">
        {expertAway ? (
          <p className="ap-practice__away">The expert steps back while the ghost is off. Show your own hand.</p>
        ) : (
          <HandCanvas preset="closeup" stage={STAGE} label={phase === 'watch' ? "The expert's chalk hand works a wooden puppet hand on strings; both make exactly the same move" : "The expert's chalk hand plays the move"}>
            <FramingCamera progress={progress} far={prop === 'racket' ? 1.3 : prop === 'keyboard' ? 1.25 : 1} />
            <ExpertSide coach={coach} side={side} prop={prop} cue={cue} progress={progress} watching={phase === 'watch' || transitionAt !== null} />
          </HandCanvas>
        )}
        <figcaption className="ap-practice__cap">The expert</figcaption>
        {!expertAway && video}
      </figure>
      <figure className="ap-practice__pane">
        <HandCanvas preset="closeup" stage={STAGE} label={phase === 'watch' ? 'Your wooden hand, live from the glove' : policy.showMaster ? "Your wooden hand with the expert's ghost over it" : 'Your wooden hand on its own'}>
          <FramingCamera progress={() => 1} far={prop === 'racket' ? 1.3 : prop === 'keyboard' ? 1.25 : 1} />
          <LearnerSide coach={coach} gloves={gloves} side={side} prop={prop} cue={cue} policy={policy} toleranceDeg={toleranceDeg} progress={progress} trying={phase === 'try' || transitionAt !== null} />
        </HandCanvas>
        <figcaption className="ap-practice__cap">You</figcaption>
      </figure>
    </div>
  );
}

/**
 * The stage's default view, between the watching frame (puppeteer and puppet) and the role-card frame on one hand. The
 * learner may orbit away from it; the change from watching to trying carries the camera to the new frame, and Reset view
 * comes back to whichever frame is current.
 */
function FramingCamera({ progress, far }: { progress: () => number; far: number }) {
  const camera = useThree((s) => s.camera);
  const orbit = useStageOrbit();
  const scratch = useMemo(() => ({ watch: cardCamera(8 * far, 24, AIM_Y + WATCH_RAISE), card: cardCamera(5.8 * far, 55, AIM_Y), pos: new Vector3() }), [far]);
  const shown = useRef<number | null>(null);
  const view = (): OrbitView => {
    const e = ease(progress());
    scratch.pos.lerpVectors(scratch.watch, scratch.card, e);
    return { position: [scratch.pos.x, scratch.pos.y, scratch.pos.z], target: [0, AIM_Y + WATCH_RAISE * (1 - e), 0] };
  };
  if (orbit) orbit.framing = view;
  // Move the camera only while the framing itself moves, so an orbit the learner made stays put between changes.
  const apply = (force: boolean) => {
    const e = ease(progress());
    if (!force && shown.current === e) return;
    shown.current = e;
    const v = view();
    if (orbit?.rig) orbit.rig.place(v);
    else {
      camera.position.set(...v.position);
      camera.lookAt(...v.target);
    }
  };
  useLayoutEffect(() => apply(true), [scratch]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(
    () => () => {
      if (orbit) orbit.framing = null;
    },
    [orbit],
  );
  useFrame(() => apply(false));
  return null;
}

interface SideProps {
  coach: ModeProps['coach'];
  side: ModeProps['side'];
  prop: ModeProps['prop'];
  cue: ModeProps['cue'];
  progress: () => number;
}

/** Left: the expert's chalk hand; while watching it hangs from the crossbar and a wooden puppet below copies it exactly. */
function ExpertSide({ coach, side, prop, cue, progress, watching }: SideProps & { watching: boolean }) {
  const master = useRef<HandHandle>(null);
  const puppet = useRef<HandHandle>(null);
  const lift = useRef<Group>(null);
  const bar = useRef<Group>(null);
  const sink = useRef<Group>(null);
  const strings = useRef(1);
  const getMaster = () => coach.live.current.master;

  useFrame(() => {
    const k = progress();
    // The bar and its threads lift away first, the puppet sinks out of the frame, then the expert floats down to rest.
    const up = ease(clamp01(k / 0.55));
    const down = ease(clamp01((k - 0.2) / 0.8));
    if (lift.current) lift.current.position.y = PUPPETEER_LIFT * (1 - down);
    if (bar.current) {
      bar.current.position.y = 3 * up * up;
      bar.current.visible = up < 0.98;
    }
    if (sink.current) {
      sink.current.position.y = -2.6 * up * up;
      sink.current.visible = up < 0.98;
    }
    strings.current = 1 - clamp01(k / 0.35);
  });

  return (
    <>
      <group ref={lift}>
        <Hand ref={master} side={side} style="chalk" getFrame={getMaster}>
          {prop === 'racket' && <Racket />}
          {cue === 'racket' && <RacketSketch />}
        </Hand>
      </group>
      {watching && (
        <>
          <group ref={bar}>
            <Crossbar master={master} height={0.7} />
          </group>
          <group ref={sink}>
            <Hand ref={puppet} side={side} style="wood" getFrame={getMaster} />
          </group>
          <PuppetStrings master={master} puppet={puppet} fade={strings} />
        </>
      )}
    </>
  );
}

/** Slack threads from each expert fingertip to the puppet's: the two hands move as one, so nothing ever pulls them taut. */
function PuppetStrings({ master, puppet, fade }: { master: RefObject<HandHandle>; puppet: RefObject<HandHandle>; fade: { current: number } }) {
  const stage = useStageColors();
  const size = useThree((s) => s.size);
  const built = useMemo(() => {
    const group = new Group();
    const colour = new Color(stage.thread);
    const lines = FINGERS.map(() => {
      const geo = new LineGeometry();
      geo.setPositions(new Float32Array(STRING_POINTS * 3));
      const mat = new LineMaterial({ color: colour.getHex(), linewidth: 3.4, worldUnits: false, transparent: true });
      const line = new Line2(geo, mat);
      line.frustumCulled = false;
      line.renderOrder = 5;
      group.add(line);
      return line;
    });
    return { group, lines };
  }, [stage.thread]);
  useEffect(
    () => () =>
      built.lines.forEach((l) => {
        l.geometry.dispose();
        (l.material as LineMaterial).dispose();
      }),
    [built],
  );
  const scratch = useMemo(() => ({ a: new Vector3(), b: new Vector3(), seg: new Float32Array((STRING_POINTS - 1) * 6) }), []);
  const FAN = [-1.1, -0.55, 0, 0.55, 1.1];
  useFrame(() => {
    const m = master.current;
    const p = puppet.current;
    built.group.visible = Boolean(m && p) && fade.current > 0.01;
    if (!built.group.visible || !m || !p) return;
    FINGERS.forEach((f, i) => {
      m.getTipWorld(f, scratch.a);
      p.getTipWorld(f, scratch.b);
      writeStringSegments([scratch.a.x, scratch.a.y, scratch.a.z], [scratch.b.x, scratch.b.y, scratch.b.z], 1, FAN[i], scratch.seg);
      const line = built.lines[i];
      const attr = line.geometry.attributes.instanceStart as unknown as { data: InstancedInterleavedBuffer };
      attr.data.array.set(scratch.seg);
      attr.data.needsUpdate = true;
      const mat = line.material as LineMaterial;
      mat.opacity = fade.current;
      mat.resolution.set(size.width, size.height);
    });
  });
  return <primitive object={built.group} />;
}

/** Right: your live wooden hand; once trying, the expert's ghost floats down over it, with the live corrections. */
function LearnerSide({ coach, gloves, side, prop, cue, policy, toleranceDeg, progress, trying }: SideProps & Pick<ModeProps, 'gloves' | 'policy' | 'toleranceDeg'> & { trying: boolean }) {
  const learner = useRef<HandHandle>(null);
  const ghost = useRef<HandHandle>(null);
  const fall = useRef<Group>(null);
  const mats = useRef<{ rig: unknown; list: Material[] }>({ rig: null, list: [] });
  const showGhost = trying && policy.showMaster;

  useFrame(() => {
    const k = progress();
    const settle = ease(clamp01((k - 0.25) / 0.75));
    if (fall.current) fall.current.position.y = GHOST_FALL * (1 - settle);
    const g = ghost.current;
    if (!g) return;
    if (mats.current.rig !== g.rig) {
      const list: Material[] = [];
      g.rig.root.traverse((o) => {
        if (o instanceof Mesh && !list.includes(o.material as Material)) list.push(o.material as Material);
      });
      mats.current = { rig: g.rig, list };
    }
    for (const m of mats.current.list) {
      m.userData.baseOpacity ??= m.opacity;
      m.opacity = (m.userData.baseOpacity as number) * settle;
    }
  });

  return (
    <>
      {prop === 'keyboard' && <Keyboard handRef={learner} />}
      <PropCue prop={cue} hand={learner} />
      <LearnerHand ref={learner} coach={coach} gloves={gloves} side={side} prop={prop} cue={cue} />
      {trying && <FaultMarks hand={learner} coach={coach} policy={policy} toleranceDeg={toleranceDeg} />}
      {showGhost && (
        <>
          <FingerTinter hand={ghost} coach={coach} policy={policy} goodTint={true} />
          <group ref={fall}>
            <Hand ref={ghost} side={side} style="ghost" getFrame={() => coach.live.current.master} scale={1.12} position={[0, 0.02, 0.05]} />
          </group>
        </>
      )}
    </>
  );
}
