import { lazy, useState } from 'react';
import { useLoopClock } from '../clock';
import { StageFrame } from '../StageFrame';
import { PlayButton, useTake } from './shared';

// three.js and the hand come in their own chunk; the text and the poster show without it.
const Stage3D = lazy(() => import('./ExpertStage3D'));

/** A real screenshot of this stage from the browser check, shown until the live 3D stage draws its first frame. */
const POSTER = './posters/expert.jpg';

export default function ExpertStop() {
  const take = useTake('expert');
  const clock = useLoopClock(take?.duration ?? 6);
  const [live, setLive] = useState(false);
  return (
    <section className="tour-stop">
      <p className="tour-lead">
        A member of our team recorded the table tennis wrist snap as the expert, wearing Rokoko gloves. This take is the lesson's expert reference. The chalk hand plays it
        frame by frame.
      </p>
      <StageFrame poster={POSTER} live={live} text="The expert's chalk hand snaps the wrist, as at the end of a forehand.">
        <Stage3D take={take} clock={clock} onLive={() => setLive(true)} />
      </StageFrame>
      <div className="tour-controls">
        <PlayButton clock={clock} />
        <span className="tour-time">{take ? `${clock.shown.toFixed(1)} s of ${take.duration.toFixed(1)} s` : "Loading the expert's take..."}</span>
      </div>
      <p className="tour-small">
        Recorded on 15 November 2026. Shown at 30 frames a second: the wrist turn and three bends in each finger. Drag the stage to turn it.
      </p>
    </section>
  );
}
