import type { ReactNode } from 'react';
import type { GloveStreamHandle, Hands, Prop, Side } from '../../../api';
import { Hand, HandCanvas, Racket } from '../../../three';
import { useHandSides } from '../hooks/useHandSides';
import { handsSides } from '../../shared/sessionPrefs';

interface LiveHandStageProps {
  glove: GloveStreamHandle;
  showJoints: boolean;
  showTrails: boolean;
  /** The move's prop; draw it only when the session's prop switch is on (pass 'none' otherwise). */
  prop?: Prop;
  /** The hands set-up: only these gloves are shown (a missing glove rests). Without it, whatever streams is shown. */
  hands?: Hands;
  /** Overlay content (the move name in plain italic) positioned over the stage. */
  children?: ReactNode;
  /** A take is recording: the stage gets a walnut-ink inner rule. */
  live?: boolean;
}

/**
 * The big 3D stage with the live glove hand: one hand centred, or both side by side for a two-handed set-up.
 * Frames reach the hands through a ref, so this component renders only when the set of hands changes.
 */
export function LiveHandStage({ glove, showJoints, showTrails, prop = 'none', hands, children, live = false }: LiveHandStageProps) {
  const streamed = useHandSides(glove);
  const sides: Side[] = hands ? handsSides(hands) : streamed.length ? streamed : ['right'];
  const pair = sides.length === 2;
  // The racket goes in the playing hand: the only hand of a one-handed set-up, else the right.
  const holder: Side = sides.length === 1 ? sides[0] : 'right';
  return (
    <div className={`mst-stage ${live ? 'mst-stage--live' : ''}`}>
      <HandCanvas preset={pair ? 'pair' : prop === 'racket' ? 'racket' : 'single'} label="Live view of your glove hand">
        {sides.map((s) => (
          <Hand key={s} side={s} style="chalk" live={glove.latest} showJoints={showJoints} showTrails={showTrails} position={pair ? [s === 'left' ? -0.85 : 0.85, 0, 0] : [0, 0, 0]}>
            {prop === 'racket' && s === holder && <Racket />}
          </Hand>
        ))}
      </HandCanvas>
      <div className="mst-stage__overlay">{children}</div>
    </div>
  );
}
