import '../threeSetup';
import { Hand } from '../../three/Hand';
import { HandCanvas } from '../../three/Stage';
import { handAt } from '../../features/shared/playback';
import { useLoopClock } from '../clock';
import type { TourTake } from '../data';
import { StageFrame } from '../StageFrame';
import { PlayButton, useTake } from './shared';

export default function ExpertStop() {
  const take = useTake('expert');
  return (
    <section className="tour-stop">
      <p className="tour-lead">
        A member of our team recorded the table tennis shakehand grip as the expert, wearing Rokoko gloves. The chalk hand plays that real take, frame by frame.
      </p>
      {take ? <ExpertStage take={take} /> : <p className="tour-loading">Loading the expert's take...</p>}
      <p className="tour-small">
        Recorded on 14 November 2026. Shown at 30 frames a second: the wrist turn and three bends in each finger. Drag the stage to turn it.
      </p>
    </section>
  );
}

function ExpertStage({ take }: { take: TourTake }) {
  const clock = useLoopClock(take.duration);
  return (
    <>
      <StageFrame text="The expert's chalk hand closes into the shakehand grip around an unseen racket handle.">
        <HandCanvas preset="single" stage={{ decor: false }} label="The expert's recorded hand, in chalk">
          <Hand side={take.side} style="chalk" getFrame={() => handAt(take.frames, clock.now(), take.side)} />
        </HandCanvas>
      </StageFrame>
      <div className="tour-controls">
        <PlayButton clock={clock} />
        <span className="tour-time">
          {clock.shown.toFixed(1)} s of {take.duration.toFixed(1)} s
        </span>
      </div>
    </>
  );
}
