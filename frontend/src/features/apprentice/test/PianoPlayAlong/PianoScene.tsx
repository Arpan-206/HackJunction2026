import { useRef } from 'react';
import { Hand, HandCanvas, Keyboard, KeysSketch, type HandHandle } from '../../../../three';
import type { GloveStreamHandle } from '../../../../api';

interface PianoSceneProps {
  gloves: GloveStreamHandle;
  twoPlayer: boolean;
  /** Draw the solid keyboard; otherwise the keys are sketched in chalk on the table. */
  showProp?: boolean;
  /** Whenever this changes the view snaps back to its default (each new run starts on the usual view). */
  resetKey?: unknown;
}

/** The paper keyboard on the table with one wooden hand over it, or two keyboards and two hands for the duel. */
export function PianoScene({ gloves, twoPlayer, showProp = true, resetKey }: PianoSceneProps) {
  const Keys = showProp ? Keyboard : KeysSketch;
  const right = useRef<HandHandle>(null);
  const left = useRef<HandHandle>(null);
  return (
    <HandCanvas preset="keyboard" label="A paper keyboard on the table with your wooden hands above it" stage={{ cameraPosition: [0, 3.1, 2.4], target: [0, -0.4, -1.15] }} resetKey={resetKey}>
      {twoPlayer ? (
        <>
          <group position={[-0.78, 0, 0]}>
            <Keys keys={7} handRef={left} />
          </group>
          <group position={[0.78, 0, 0]}>
            <Keys keys={7} handRef={right} />
          </group>
          <Hand ref={left} side="left" style="wood" live={gloves.latest} position={[-0.78, 0, 0]} />
          <Hand ref={right} side="right" style="wood" live={gloves.latest} position={[0.78, 0, 0]} />
        </>
      ) : (
        <>
          <Keys keys={9} handRef={right} />
          <Hand ref={right} side="right" style="wood" live={gloves.latest} position={[0.1, 0, 0]} />
        </>
      )}
    </HandCanvas>
  );
}
