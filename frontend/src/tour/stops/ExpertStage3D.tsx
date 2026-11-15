import '../threeSetup';
import { Hand } from '../../three/Hand';
import { HandCanvas } from '../../three/Stage';
import { handAt } from '../../features/shared/playback';
import type { LoopClock } from '../clock';
import type { TourTake } from '../data';
import { FirstFrame } from '../FirstFrame';
import { SIDE_VIEW } from './shared';

/** The first stop's live 3D stage: its own chunk, so the stop's text and poster never wait for three.js. */
export default function ExpertStage3D({ take, clock, onLive }: { take: TourTake | null; clock: LoopClock; onLive: () => void }) {
  return (
    <HandCanvas preset="single" stage={{ decor: false, cameraPosition: SIDE_VIEW }} label="The expert's recorded hand, in chalk">
      {take && (
        <>
          <Hand side={take.side} style="chalk" getFrame={() => handAt(take.frames, clock.now(), take.side)} />
          <FirstFrame onLive={onLive} />
        </>
      )}
    </HandCanvas>
  );
}
