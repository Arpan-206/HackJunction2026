import '../threeSetup';
import { Hand } from '../../three/Hand';
import { HandCanvas } from '../../three/Stage';
import { handAt } from '../../features/shared/playback';
import { useLoopClock } from '../clock';
import type { TourTake } from '../data';
import { StageFrame } from '../StageFrame';
import { PlayButton, SIDE_VIEW, useTake } from './shared';

export default function ExpertStop() {
  const take = useTake('expert');
  return (
    <section className="tour-stop">
      <p className="tour-lead">
        A member of our team recorded the table tennis shakehand grip as the expert, wearing Rokoko gloves. The chalk hand plays that real take, frame by frame.
      </p>
      <ExpertStage take={take} />
      <p className="tour-small">
        Recorded on 14 November 2026. Shown at 30 frames a second: the wrist turn and three bends in each finger. Drag the stage to turn it.
      </p>
    </section>
  );
}

/** The stage opens at once; the hand joins it when the take's small chunk has arrived. */
function ExpertStage({ take }: { take: TourTake | null }) {
  const clock = useLoopClock(take?.duration ?? 6);
  return (
    <>
      <StageFrame text="The expert's chalk hand closes into the shakehand grip around an unseen racket handle.">
        <HandCanvas preset="single" stage={{ decor: false, cameraPosition: SIDE_VIEW }} label="The expert's recorded hand, in chalk">
          {take && <Hand side={take.side} style="chalk" getFrame={() => handAt(take.frames, clock.now(), take.side)} />}
        </HandCanvas>
      </StageFrame>
      <div className="tour-controls">
        <PlayButton clock={clock} />
        <span className="tour-time">{take ? `${clock.shown.toFixed(1)} s of ${take.duration.toFixed(1)} s` : "Loading the expert's take..."}</span>
      </div>
    </>
  );
}
