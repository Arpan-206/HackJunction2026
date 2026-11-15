import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { FINGERS, type Finger, type HandFrame, type ScoreResult, type Side } from '../../../../api/types';
import { Hand, restFrame, type HandHandle } from '../../../../three';
import { ScorePlaque } from '../../../../design/guild3d';
import { Leaders, type LeaderNote } from '../../../../design/Leaders';
import { SceneCanvas, onHand, useBoard } from '../../../../design/scene';
import '../../../../design/design.css';
import { OK_FROM } from './scoreRules';

/** The bench framing of the round 3 score frame (design/frames/Score.tsx), a step closer: the hand in front, the plaque behind. */
const CAM = { position: [0.7, 3.4, 4.1] as [number, number, number], target: [0, -0.2, -1.05] as [number, number, number] };

const SHORT: Record<Finger, string> = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', little: 'Little' };

type Slot = { side: 'left' | 'right'; top: string };

/**
 * The hand lies thumb side to the camera with its fingers towards the left gutter (mirrored for a left hand), so every
 * finger shows in profile instead of curling away under the back of the hand.
 */
const HAND_AT: [number, number, number] = [1.3, 0, -1.2];
const HAND_TURN = Math.PI * 0.68;

/**
 * Label slots in the stage gutters, as a share of the stage height, so the notes never sit on the hand. They stack down
 * the gutter the fingertips point to, in the order the tips do, so no leader line crosses another.
 */
const SLOTS: Record<Finger, Slot> = {
  little: { side: 'left', top: '3%' },
  ring: { side: 'left', top: '17%' },
  middle: { side: 'left', top: '38%' },
  index: { side: 'left', top: '52%' },
  thumb: { side: 'left', top: '68%' },
};

/**
 * A narrow stage (a phone) has no gutters beside the hand: the notes stack in two staggered columns across the top, where
 * the plaque would be, and the plaque is left out (the same number is printed under the scene). The camera pulls back on
 * a tall stage, so the hand sits in the lower half, clear of the notes.
 */
const COMPACT_SLOTS: Record<Finger, Slot> = {
  middle: { side: 'left', top: '3%' },
  index: { side: 'left', top: '17%' },
  thumb: { side: 'left', top: '31%' },
  little: { side: 'right', top: '10%' },
  ring: { side: 'right', top: '24%' },
};
/** Stage width below which the compact layout is used, in CSS pixels. */
const COMPACT_BELOW = 620;
const GUTTER = 12;

/** The width of the element, kept up to date. */
function useWidth(ref: RefObject<HTMLElement>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export interface ScoreSceneProps {
  result: ScoreResult;
  weakest: Finger;
  allGood: boolean;
  mastery: boolean;
  /** The hand shown on the bench: the expert's shape at a telling moment of the move. */
  pose?: HandFrame | null;
  side: Side;
  /** Short line carved under the number, e.g. "Rep 3". */
  line: string;
}

/**
 * The 3D score: the learner's wooden hand on the walnut bench, a plaster plaque with the overall score (its rule laid in
 * gold leaf only at mastery), and each finger's score on a leader line pinned to that fingertip. Malachite for a finger
 * that held the shape, vermilion for the one correction. Static: nothing moves, so it suits reduced motion as it is.
 */
export default function ScoreScene({ result, weakest, allGood, mastery, pose, side, line }: ScoreSceneProps) {
  const board = useBoard();
  const hand = useRef<HandHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const compact = width > 0 && width < COMPACT_BELOW;
  // Two columns of notes and three gutters must fit side by side.
  const compactWidth = Math.floor((width - 3 * GUTTER) / 2);
  for (const f of FINGERS) board.set(f, onHand(hand, f));
  const frame = useMemo(() => pose ?? restFrame(side), [pose, side]);
  const notes: LeaderNote[] = useMemo(
    () =>
      FINGERS.map((f) => {
        const v = Math.round(result.per_finger[f]);
        const fix = f === weakest && !allGood;
        const slot = (compact ? COMPACT_SLOTS : SLOTS)[f];
        // Mirror the gutters for a left hand so each label stays on the side of its finger.
        const sideOf = side === 'left' ? (slot.side === 'left' ? 'right' : 'left') : slot.side;
        const w = compact ? compactWidth : fix ? 220 : 170;
        return { id: f, side: sideOf, top: slot.top, inset: compact ? GUTTER : undefined, width: w, tone: fix ? 'fix' : v >= OK_FROM ? 'ok' : 'ink', title: `${SHORT[f]} ${v}`, body: fix && !compact ? 'The one to fix' : undefined };
      }),
    [result, weakest, allGood, side, compact, compactWidth],
  );
  return (
    <div ref={box} className="ap-score3d__box">
      <SceneCanvas world="bench" {...CAM} board={board} orbit={false} bench={{ circle: 0, showShadow: true, props: false }} label="Your hand on the bench with the score plaque">
        <Hand
          ref={hand}
          style="wood"
          side={side}
          position={side === 'left' ? [-HAND_AT[0], HAND_AT[1], HAND_AT[2]] : HAND_AT}
          rotation={[0, side === 'left' ? -HAND_TURN : HAND_TURN, 0]}
          frame={frame}
          smoothing={false}
          // the score picture is composed around the hand: it stays in its place, wherever the wrist was in the room
          followWristPos={false}
        />
        {!compact && (
          <group position={[0, -0.55, -2.55]} scale={0.8}>
            <ScorePlaque position={[0, 0, 0]} score={String(Math.round(result.overall))} line={line} learned={mastery} />
          </group>
        )}
      </SceneCanvas>
      {width > 0 && <Leaders board={board} notes={notes} world="field" />}
    </div>
  );
}
