import { useRef } from 'react';
import { Hand, HandCanvas, Keyboard, type HandHandle } from '../../../../three';
import type { GloveStreamHandle } from '../../../../api';

interface PianoSceneProps {
  gloves: GloveStreamHandle;
  twoPlayer: boolean;
}

/** The paper keyboard on the table with one wooden hand over it, or two keyboards and two hands for the duel. */
export function PianoScene({ gloves, twoPlayer }: PianoSceneProps) {
  const right = useRef<HandHandle>(null);
  const left = useRef<HandHandle>(null);
  return (
    <HandCanvas preset="keyboard" label="A paper keyboard on the table with your wooden hands above it" stage={{ cameraPosition: [0, 3.1, 2.4], target: [0, -0.4, -1.15] }}>
      {twoPlayer ? (
        <>
          <group position={[-0.78, 0, 0]}>
            <Keyboard keys={7} handRef={left} />
          </group>
          <group position={[0.78, 0, 0]}>
            <Keyboard keys={7} handRef={right} />
          </group>
          <Hand ref={left} side="left" style="wood" live={gloves.latest} position={[-0.78, 0, 0]} />
          <Hand ref={right} side="right" style="wood" live={gloves.latest} position={[0.78, 0, 0]} />
        </>
      ) : (
        <>
          <Keyboard keys={9} handRef={right} />
          <Hand ref={right} side="right" style="wood" live={gloves.latest} position={[0.1, 0, 0]} />
        </>
      )}
    </HandCanvas>
  );
}
