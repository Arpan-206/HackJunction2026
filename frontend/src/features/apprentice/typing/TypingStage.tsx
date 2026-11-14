import { useMemo, type ReactNode, type Ref, type RefObject } from 'react';
import type { Finger, GloveFrame, HandFrame, MotionSpec, Side } from '../../../api/types';
import { Hand, HandCanvas, TypingKeyboard, TYPING_HAND_X, TYPING_HAND_Y, useStageColors, type HandHandle } from '../../../three';

/** What a finger is marked with: the cue to strike next (chalk), right (malachite) or a correction (vermilion). */
export type FingerMark = 'cue' | 'ok' | 'off';

export interface TypingHand {
  /** Drives the hand each frame (a coach, a replay or a simulated strike); falls back to `live`. */
  getFrame?: () => HandFrame | null;
  live?: RefObject<GloveFrame | null>;
  /** A guide motion to play when nothing else drives the hand. */
  motion?: MotionSpec;
  marks?: Partial<Record<Finger, FingerMark>>;
  handRef?: Ref<HandHandle>;
}

interface TypingStageProps {
  /** Solid keyboard ("Add a prop"); otherwise sketched in chalk. */
  solid: boolean;
  target?: string | null;
  /** Read every frame instead of `target`. */
  getTarget?: () => string | null;
  good?: string | null;
  hands: Record<Side, TypingHand>;
  /** Wooden hands for the learner (default), chalk for the expert on the skill page. */
  style?: 'wood' | 'chalk';
  /** The expert's hands as ghosts over the learner's, for the lesson room. */
  ghost?: Record<Side, () => HandFrame | null> | null;
  label: string;
  /** Whenever this changes the view snaps back to its default (a game's round start). */
  resetKey?: unknown;
  /** Extra things inside the canvas, such as the correction marks. */
  children?: ReactNode;
}

const SIDES: Side[] = ['left', 'right'];
export const TYPING_CAMERA: { cameraPosition: [number, number, number]; target: [number, number, number] } = {
  cameraPosition: [0, 4.6, -0.25],
  target: [0, -0.55, -1.6],
};

function position(side: Side): [number, number, number] {
  return [side === 'left' ? -TYPING_HAND_X : TYPING_HAND_X, TYPING_HAND_Y, 0];
}

function Hands({ hands, ghost, style = 'wood' }: Pick<TypingStageProps, 'hands' | 'ghost' | 'style'>) {
  const stage = useStageColors();
  const colour = useMemo(() => ({ cue: stage.chalk, ok: stage.malachite, off: stage.vermilion }), [stage.chalk, stage.malachite, stage.vermilion]);
  return (
    <>
      {SIDES.map((side) => {
        const h = hands[side];
        const tint: Partial<Record<Finger, string>> = {};
        // The thumb's tint reaches down to its root at the wrist, a large patch between the hands that hides the space bar,
        // so the space bar's cue stays on the key (lit, or malachite after a right strike) and the thumb is left untinted.
        for (const [f, m] of Object.entries(h.marks ?? {}) as [Finger, FingerMark][]) if (f !== 'thumb') tint[f] = colour[m];
        return <Hand key={side} ref={h.handRef} side={side} style={style} live={h.live} getFrame={h.getFrame} motion={h.motion} fingerTint={tint} position={position(side)} />;
      })}
      {ghost && SIDES.map((side) => <Hand key={`ghost-${side}`} side={side} style="ghost" opacity={0.7} getFrame={ghost[side]} position={position(side)} />)}
    </>
  );
}

/** Two hands over a QWERTY keyboard on the bench: the stage for touch typing lessons, air typing and the keyboard mode. */
export function TypingStage({ solid, target = null, getTarget, good = null, hands, ghost = null, style, label, resetKey, children }: TypingStageProps) {
  return (
    <HandCanvas preset="keyboard" label={label} stage={TYPING_CAMERA} resetKey={resetKey}>
      <TypingKeyboard solid={solid} target={target} getTarget={getTarget} good={good} />
      <Hands hands={hands} ghost={ghost} style={style} />
      {children}
    </HandCanvas>
  );
}
