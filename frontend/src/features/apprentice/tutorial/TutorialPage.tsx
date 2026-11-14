import { useEffect, useRef, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { tutorialVideoOf, useMediaSrc, type Lesson, type Step } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { Button, ButtonLink } from '../../../components/ui';
import { Hand, HandCanvas, Keyboard, Racket, RacketSketch } from '../../../three';
import { ApHeader } from '../ApHeader';
import { stepSide, useReferenceTrack } from '../hooks/useReferenceTrack';
import { useLessonById } from '../hooks/useLessonData';
import { markTutorialSeen } from '../pipeline/journey';
import { presetFor } from '../training/modes/Shadow';
import type { ReferenceTrack } from '../training/coach/reference';
import { shownProp, useShowProps } from '../../shared/sessionPrefs';
import { clockLabel, takeTimeAt, useLoopClock, useVideoClock, type TutorialClock } from './useTutorialClock';

/** Route `/apprentice/lessons/:lessonId/steps/:stepIndex/tutorial`: the first part of a lesson, before practice. */
export function TutorialPage() {
  const { lessonId, stepIndex } = useParams();
  const { data: lesson, loading, error, offline } = useLessonById(lessonId);
  const index = Number(stepIndex ?? 0);
  const step = lesson?.steps[index] ?? null;

  if (loading) return <p className="note ap-state">Opening the tutorial...</p>;
  if (error || !lesson || !step) {
    return (
      <div className="ap-state">
        <PageHeader title="Tutorial not found" />
        <p className="note">{error?.message ?? 'That lesson does not exist.'}</p>
        <ButtonLink to={lesson ? `/apprentice/lessons/${lesson.id}` : '/apprentice'} variant="secondary">
          {lesson ? 'Back to the course' : 'Back to skills'}
        </ButtonLink>
      </div>
    );
  }
  return <Tutorial key={step.id} lesson={lesson} step={step} index={index} offline={offline} />;
}

interface TutorialProps {
  lesson: Lesson;
  step: Step;
  index: number;
  offline: boolean;
}

function Tutorial({ lesson, step, index, offline }: TutorialProps) {
  const navigate = useNavigate();
  const side = stepSide(step);
  const { track, loading } = useReferenceTrack(step, side);
  const video = tutorialVideoOf(step);
  const src = useMediaSrc(video?.url);
  const practiceTo = `/apprentice/lessons/${lesson.id}/steps/${index}`;

  const start = () => {
    markTutorialSeen(lesson.id, step.id);
    navigate(practiceTo, { state: { fromTutorial: true } });
  };

  return (
    <div className="ap-tut">
      <ApHeader title={step.title} context={`Tutorial for lesson ${index + 1} of ${lesson.title}`} back={{ to: `/apprentice/lessons/${lesson.id}`, label: 'Back to syllabus' }} />
      {offline && <p className="note ap-banner">Backend offline: showing the built-in demo lesson.</p>}
      {loading || !track ? (
        <p className="note ap-state">Loading the expert&rsquo;s recording...</p>
      ) : src && video ? (
        <WithVideo src={src} offset={video.offset_s} track={track} step={step} expert={lesson.master_name} onStart={start} onEnded={() => markTutorialSeen(lesson.id, step.id)} />
      ) : (
        <HandOnly track={track} step={step} onStart={start} />
      )}
    </div>
  );
}

interface PartProps {
  track: ReferenceTrack;
  step: Step;
  onStart: () => void;
}

/** The expert talking, large, with the chalk hand beside it playing the reference take on the video's clock. */
function WithVideo({ src, offset, track, step, expert, onStart, onEnded }: PartProps & { src: string; offset: number; expert: string; onEnded: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const clock = useVideoClock(ref, src);
  const handTime = () => takeTimeAt(clock.now(), offset);
  useEffect(() => {
    if (clock.ended) onEnded();
  }, [clock.ended, onEnded]);
  return (
    <>
      <div className="ap-tut__grid ap-tut__grid--video">
        <figure className="ap-tut__pane ap-tut__pane--video">
          <video ref={ref} className="ap-tut__video" src={src} preload="auto" playsInline onClick={clock.toggle} aria-label={`${expert} explains ${step.title}`} />
          {!clock.playing && (
            <button type="button" className="ap-tut__bigplay" onClick={clock.toggle} aria-label="Play the tutorial">
              <PlayIcon size={34} />
            </button>
          )}
          <figcaption className="ap-tut__cap">{expert}</figcaption>
        </figure>
        <figure className="ap-tut__pane">
          <TutorialHand track={track} step={step} time={handTime} label={`The expert's chalk hand playing ${step.title} in time with the video`} />
          <figcaption className="ap-tut__cap">The expert&rsquo;s hand, in time with the video</figcaption>
        </figure>
      </div>
      <Controls clock={clock} what="video" onStart={onStart} />
      <p className="ap-instruction ap-tut__instruction">{step.instruction}</p>
    </>
  );
}

/** No video: the chalk hand alone plays the take, at half speed first, with the step's instruction beside it. */
function HandOnly({ track, step, onStart }: PartProps) {
  const clock = useLoopClock(track.period, 0.5);
  return (
    <>
      <div className="ap-tut__grid">
        <figure className="ap-tut__pane">
          <TutorialHand track={track} step={step} time={clock.now} label={`The expert's chalk hand playing ${step.title}`} />
          <figcaption className="ap-tut__cap">{track.source === 'recording' ? <>The expert&rsquo;s recorded hand</> : 'A guide hand plays the move'}</figcaption>
        </figure>
        <div className="ap-tut__notes">
          <p className="ap-instruction">{step.instruction}</p>
          <p className="ap-tut__hint">Watch which fingers move, and when. Nothing is scored here.</p>
        </div>
      </div>
      <Controls clock={clock} what="move" onStart={onStart} />
    </>
  );
}

function TutorialHand({ track, step, time, label }: { track: ReferenceTrack; step: Step; time: () => number; label: string }) {
  const [showProps] = useShowProps();
  const prop = shownProp(step.prop, showProps);
  const cue = showProps ? 'none' : step.prop;
  const preset = presetFor(prop === 'none' ? cue : prop);
  const getFrame = () => track.handAt(time());
  return (
    <HandCanvas preset={preset} label={label} className="ap-tut__canvas">
      {prop === 'keyboard' && <Keyboard />}
      <Hand side={track.side} style="chalk" getFrame={getFrame}>
        {prop === 'racket' && <Racket />}
        {cue === 'racket' && <RacketSketch />}
      </Hand>
    </HandCanvas>
  );
}

function PlayIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

function PauseIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
    </svg>
  );
}

/** Play or pause, a scrubber over the video (or one take), half speed, and the way on to practice. */
function Controls({ clock, what, onStart }: { clock: TutorialClock; what: 'video' | 'move'; onStart: () => void }) {
  const max = Math.max(0.1, clock.duration);
  const onScrub = (e: ChangeEvent<HTMLInputElement>) => clock.seek(Number(e.target.value));
  return (
    <div className="ap-tut__bar">
      <button type="button" className="btn btn--secondary ap-tut__toggle" onClick={clock.toggle} aria-label={clock.playing ? `Pause the ${what}` : `Play the ${what}`}>
        {clock.playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <input
        className="ap-tut__scrub"
        type="range"
        min={0}
        max={max}
        step={0.05}
        value={Math.min(clock.time, max)}
        onChange={onScrub}
        aria-label={what === 'video' ? 'Position in the video' : 'Position in the move'}
        aria-valuetext={`${clockLabel(clock.time)} of ${clockLabel(clock.duration)}`}
      />
      <span className="ap-tut__time ap-num">
        {clockLabel(clock.time)} / {clockLabel(clock.duration)}
      </span>
      <Button variant="toggle" aria-pressed={clock.rate === 0.5} onClick={() => clock.setRate(clock.rate === 0.5 ? 1 : 0.5)}>
        Half speed
      </Button>
      <Button large className="ap-tut__go" onClick={onStart}>
        Start practising
      </Button>
    </div>
  );
}
