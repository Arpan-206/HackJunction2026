import type { ReactNode } from 'react';
import type { GloveStreamHandle, HandFrame, Hands, Prop, Side } from '../../../api';
import { Hand, HandCanvas, PAIR_LIFT, PAIR_SPREAD, PAIR_STAGE, Racket } from '../../../three';
import { useHandSides } from '../hooks/useHandSides';
import { handsSides } from '../../shared/sessionPrefs';
import { CameraControls, ExpertCameraRig, useCameraRig } from './ExpertCamera';
import { EXPERT_STAGE_CAMERA, expertFrame, expertStage, PAIR_HALF_GAP } from './cameraPresets';

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
  /**
   * The expert's first-person view (the role select cards' angle) with the camera buttons, for the scratch Record screen.
   * Off: the stage presets the step recorder has always used.
   */
  firstPerson?: boolean;
  /**
   * Play a recorded take on this stage in place of the live hand (same camera and buttons). `ghost`, when given, draws a
   * second take as a faint ghost on the same spot, to compare against.
   */
  playback?: { getFrame: (side: Side) => HandFrame | null; ghost?: (side: Side) => HandFrame | null } | null;
}

/**
 * The big 3D stage with the live glove hand: one hand centred, or both side by side for a two-handed set-up.
 * Frames reach the hands through a ref, so this component renders only when the set of hands changes.
 */
export function LiveHandStage({ glove, showJoints, showTrails, prop = 'none', hands, children, live = false, firstPerson = false, playback = null }: LiveHandStageProps) {
  const streamed = useHandSides(glove);
  const sides: Side[] = hands ? handsSides(hands) : streamed.length ? streamed : ['right'];
  const pair = sides.length === 2;
  // The racket goes in the playing hand: the only hand of a one-handed set-up, else the right.
  const holder: Side = sides.length === 1 ? sides[0] : 'right';
  const rig = useCameraRig();
  const frame = firstPerson ? expertFrame('record', sides) : null;
  const spread = frame ? PAIR_HALF_GAP : PAIR_SPREAD;
  return (
    <div className={`mst-stage ${live ? 'mst-stage--live' : ''}`}>
      <HandCanvas preset={pair ? 'pair' : prop === 'racket' ? 'racket' : 'single'} stage={frame ? expertStage(frame) : pair ? PAIR_STAGE : undefined} label="Live view of your glove hand">
        {frame && <ExpertCameraRig frame={frame} sides={sides} preset={EXPERT_STAGE_CAMERA[frame.key]} rig={rig} />}
        {sides.map((s) => {
          const at: [number, number, number] = pair ? [s === 'left' ? -spread : spread, PAIR_LIFT, 0] : [0, 0, 0];
          const ghost = playback?.ghost;
          return (
            <group key={`${s}-${playback ? 'take' : 'live'}`}>
              {playback ? (
                <Hand side={s} style="chalk" getFrame={() => playback.getFrame(s)} showJoints={showJoints} showTrails={showTrails} position={at}>
                  {prop === 'racket' && s === holder && <Racket />}
                </Hand>
              ) : (
                <Hand side={s} style="chalk" live={glove.latest} showJoints={showJoints} showTrails={showTrails} position={at}>
                  {prop === 'racket' && s === holder && <Racket />}
                </Hand>
              )}
              {ghost && <Hand side={s} style="ghost" getFrame={() => ghost(s)} position={at} opacity={0.7} />}
            </group>
          );
        })}
      </HandCanvas>
      <div className="mst-stage__overlay">{children}</div>
      {frame && <CameraControls rig={rig} base={EXPERT_STAGE_CAMERA[frame.key]} />}
    </div>
  );
}
