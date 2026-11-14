import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshBasicMaterial, TorusGeometry, Vector3, type Mesh } from 'three';
import { FINGERS, type Side, type Step } from '../../../../api/types';
import { Hand, HandCanvas, useStageColors, type HandHandle } from '../../../../three';
import {
  layoutFor,
  projectToWall,
  Puppet,
  PUPPET_X,
  puppetLayout,
  raiseFor,
  ShadowTheatreSet,
  THEATRE_CAMERA,
  wallMagnification,
} from '../../../../three/ShadowTheatre';
import { useReferenceTrack } from '../../hooks/useReferenceTrack';
import type { AttemptPolicy } from '../coach/fade';
import type { Coach } from '../coach/useCoach';
import { FaultMarks } from './FaultMarks';
import type { ModeProps } from './types';

/** "Lesson 2: The talking dog" -> "The talking dog": the shape's name as the stage shows it. */
export function shapeName(step: Pick<Step, 'title'>): string {
  return step.title.replace(/^lesson\s*\d+\s*:\s*/i, '').trim() || step.title;
}

const WALL_RING = 0.07;

/**
 * The vermilion correction rings drawn on the wall, round the shadow of each fingertip that is out of tolerance, so the
 * learner sees the fix where they are looking. Same rule as the rings on the hand: only fingers marked 'off'.
 */
function WallRings({ hand, coach, policy }: { hand: RefObject<HandHandle>; coach: Coach; policy: AttemptPolicy }) {
  const stage = useStageColors();
  const rings = useRef<(Mesh | null)[]>([]);
  const geo = useMemo(() => new TorusGeometry(1, 0.11, 8, 48), []);
  const mat = useMemo(() => new MeshBasicMaterial({ color: stage.vermilion, transparent: true, opacity: 0.95, depthTest: false }), [stage.vermilion]);
  const tip = useMemo(() => new Vector3(), []);
  const onWall = useMemo(() => new Vector3(), []);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  useFrame(() => {
    const h = hand.current;
    const live = coach.live.current;
    const guiding = Boolean(h) && policy.liveCoach && !policy.rehearsal && live.hasLearner;
    FINGERS.forEach((f, i) => {
      const m = rings.current[i];
      if (!m) return;
      const on = guiding && live.shown.status[f] === 'off' && (!policy.focus || policy.focus.includes(f));
      m.visible = on;
      if (!on || !h) return;
      h.getTipWorld(f, tip);
      projectToWall(tip, onWall);
      m.position.copy(onWall);
      m.scale.setScalar(WALL_RING * wallMagnification(tip.z) * 1.6);
    });
  });
  return (
    <>
      {FINGERS.map((f, i) => (
        <mesh
          key={f}
          ref={(m) => {
            rings.current[i] = m;
          }}
          geometry={geo}
          material={mat}
          renderOrder={20}
          visible={false}
          userData={{ noCast: true }}
        />
      ))}
    </>
  );
}

interface ShadowPuppetsProps extends ModeProps {
  step: Step;
}

/**
 * Shadow puppets by candlelight: the oil lamp throws the expert's hands (left) and the learner's (right) onto the plaster
 * wall side by side, so the learner matches the silhouette. The shape is named above the wall; a finger out of tolerance gets
 * a vermilion ring on the learner's hand and on its shadow, with the usual correction label. Two-handed shapes show both
 * hands; the coached hand follows the coach (and its scoring), the other the glove and the expert's reference directly.
 */
export function ShadowPuppets({ coach, gloves, side, policy, toleranceDeg, step }: ShadowPuppetsProps) {
  const learner = useRef<HandHandle>(null);
  const placements = useMemo(() => puppetLayout(layoutFor(step.move_id, step.hands), undefined, raiseFor(step.move_id)), [step.move_id, step.hands]);
  const other: Side = side === 'left' ? 'right' : 'left';
  const twoHanded = step.hands === 'both';
  const otherRef = useReferenceTrack(twoHanded ? step : null, other).track;
  const name = shapeName(step);

  const expertFrame = (s: Side) => () => (s === side ? coach.live.current.master : (otherRef?.handAt(coach.live.current.refTime) ?? null));

  return (
    <div className="sp-theatre">
      <HandCanvas
        bare
        shadows
        stage={{ cameraPosition: THEATRE_CAMERA }}
        label={`Shadow puppets by lamplight: the expert's shadow on the left, yours on the right, making ${name.toLowerCase()}`}
      >
        <ShadowTheatreSet />
        <Puppet x={-PUPPET_X} placements={placements}>
          {(p) => <Hand side={p.side} style="chalk" getFrame={expertFrame(p.side)} position={p.position} rotation={p.rotation} scale={p.scale} />}
        </Puppet>
        <Puppet x={PUPPET_X} placements={placements}>
          {(p) =>
            p.side === side ? (
              <Hand ref={learner} side={p.side} style="wood" live={gloves.latest} getFrame={() => coach.live.current.learner} position={p.position} rotation={p.rotation} scale={p.scale} />
            ) : (
              <Hand side={p.side} style="wood" live={gloves.latest} position={p.position} rotation={p.rotation} scale={p.scale} />
            )
          }
        </Puppet>
        <WallRings hand={learner} coach={coach} policy={policy} />
        <FaultMarks hand={learner} coach={coach} policy={policy} toleranceDeg={toleranceDeg} />
      </HandCanvas>
      <p className="sp-theatre__name" aria-hidden="true">
        {name}
      </p>
      <span className="sp-theatre__who sp-theatre__who--expert" aria-hidden="true">
        The expert
      </span>
      <span className="sp-theatre__who sp-theatre__who--you" aria-hidden="true">
        You
      </span>
    </div>
  );
}
