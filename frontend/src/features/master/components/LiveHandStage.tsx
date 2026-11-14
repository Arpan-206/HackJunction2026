import type { ReactNode } from 'react';
import type { GloveStreamHandle, Prop, Side } from '../../../api';
import { Hand, HandCanvas, Racket } from '../../../three';
import { useHandSides } from '../hooks/useHandSides';

interface LiveHandStageProps {
  glove: GloveStreamHandle;
  showJoints: boolean;
  showTrails: boolean;
  prop?: Prop;
  /** Overlay content (the move name in plain italic) positioned over the stage. */
  children?: ReactNode;
  /** A take is recording: the stage gets a walnut-ink inner rule. */
  live?: boolean;
}

/**
 * The big 3D stage with the live glove hand: one hand centred, or both side by side when two are streaming.
 * Frames reach the hands through a ref, so this component renders only when the set of hands changes.
 */
export function LiveHandStage({ glove, showJoints, showTrails, prop = 'none', children, live = false }: LiveHandStageProps) {
  const streamed = useHandSides(glove);
  const sides: Side[] = streamed.length ? streamed : ['right'];
  const pair = sides.length === 2;
  return (
    <div className={`mst-stage ${live ? 'mst-stage--live' : ''}`}>
      <HandCanvas preset={pair ? 'pair' : prop === 'racket' ? 'racket' : 'single'} label="Live view of your glove hand">
        {sides.map((s) => (
          <Hand key={s} side={s} style="chalk" live={glove.latest} showJoints={showJoints} showTrails={showTrails} position={pair ? [s === 'left' ? -0.85 : 0.85, 0, 0] : [0, 0, 0]}>
            {prop === 'racket' && s === 'right' && <Racket />}
          </Hand>
        ))}
      </HandCanvas>
      <div className="mst-stage__overlay">{children}</div>
    </div>
  );
}
