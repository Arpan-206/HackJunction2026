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
        A member of our team recorded the table tennis wrist snap as the expert, wearing Rokoko gloves. This take is the lesson's expert reference. The chalk hand plays it frame by frame.
      </p>
      <ExpertStage take={take} />
      <p className="tour-small">
        Recorded on 15 November 2026. Shown at 30 frames a second: the wrist turn and three bends in each finger. Drag the stage to turn it.
      </p>
    </section>
  );
}

/** The stage opens at once; the hand joins it when the take's small chunk has arrived. */
function ExpertStage({ take }: { take: TourTake | null }) {
  const clock = useLoopClock(take?.duration ?? 6);
  return (
    <>
      <StageFrame text="The expert's chalk hand snaps the wrist, as at the end of a forehand.">
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
