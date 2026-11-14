import { useMemo, useRef, useState, type MutableRefObject } from 'react';
import { FINGERS, type Finger, type GloveStreamHandle, type HandFrame, type Side, type TakesModel } from '../../../api';
import { Button } from '../../../components/ui';
import { zeroValues } from '../../apprentice/training/coach/deviation';
import type { AttemptPolicy } from '../../apprentice/training/coach/fade';
import type { Coach, CoachLive, CoachView } from '../../apprentice/training/coach/useCoach';
import { usePlayback } from '../../shared/playback';
import { shownProp, useShowProps } from '../../shared/sessionPrefs';
import { useRecording } from '../hooks/useRecording';
import { primarySide, type MoveChoice } from '../lib';
import { FlowNav } from './FlowNav';
import { ReplayStage } from './ReplayStage';
import { fingersSentence, readModel } from './scratchDraft';

type View = 'strings' | 'ghost';

const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: 'strings', label: 'Strings', hint: "Your hand hovers above the apprentice's, with a string to each fingertip." },
  { id: 'ghost', label: 'Ghost', hint: "A chalk ghost of your hand lies over the apprentice's." },
];

const RATES = [0.5, 1];

const ALL_GOOD = Object.fromEntries(FINGERS.map((f) => [f, 'good'])) as Record<Finger, 'good'>;

/** Nothing is judged in a replay: the strings hang slack and no finger is marked. */
const REPLAY_POLICY: AttemptPolicy = { attempt: 1, label: 'Replay', blurb: '', showMaster: true, strings: 'all', liveCoach: false, rehearsal: true };

/**
 * A coach for the training room's guidance views that only plays back: the expert hand is the reference take at the
 * player's clock, the wooden hand is whatever glove is live (the expert's own hand, standing in for the apprentice), and
 * every finger reads as in line. Getters keep it cheap: the 3D views read them each frame, nothing re-renders.
 */
function useReplayCoach(masterAt: MutableRefObject<() => HandFrame | null>, gloves: GloveStreamHandle, side: Side): Coach {
  return useMemo(() => {
    const learner = () => gloves.latest.current?.hands.find((h) => h.side === side) ?? null;
    const live: CoachLive = {
      get learner() {
        return learner();
      },
      get master() {
        return masterAt.current();
      },
      get hasLearner() {
        return Boolean(learner());
      },
      deviation: zeroValues(),
      status: ALL_GOOD,
      tension: zeroValues(),
      refTime: 0,
      shown: { status: ALL_GOOD, deviation: zeroValues() },
    };
    const view: CoachView = { deviation: zeroValues(), status: ALL_GOOD, match: 100, tip: null, lagMs: 0, hasLearner: false, running: false, waiting: false, checkpoint: 0, checkpoints: 0, holdFraction: 0, cycle: 0 };
    return {
      live: { current: live },
      subscribe: () => () => undefined,
      getView: () => view,
      begin: () => undefined,
      end: () => ({ seconds: 0, meanAbs: zeroValues(), inTolerance: zeroValues(), meanLagMs: 0, worst: 'index', worstDeviation: 0, tip: null }),
      skip: () => undefined,
      frames: () => [],
    };
  }, [masterAt, gloves.latest, side]);
}

interface ReplayScreenProps {
  choice: MoveChoice;
  model: TakesModel;
  glove: GloveStreamHandle;
  onBack: () => void;
  onNext: () => void;
  onAddAnother: () => void;
}

/**
 * Replay: the reference take played exactly as the apprentice will meet it, in the training room's own guidance views
 * (Strings or Ghost), with play, pause, scrub, speed and loop.
 */
export function ReplayScreen({ choice, model, glove, onBack, onNext, onAddAnother }: ReplayScreenProps) {
  const [view, setView] = useState<View>('strings');
  const [loop, setLoop] = useState(true);
  const [showProps] = useShowProps();
  const side = model.side ?? primarySide(choice.hands);
  const { recording, loading, error } = useRecording(model.reference_recording_id);
  const frames = recording?.frames ?? null;
  const pb = usePlayback(frames, { loop });
  const masterAt = useRef<() => HandFrame | null>(() => null);
  masterAt.current = () => pb.getFrame(side);
  const coach = useReplayCoach(masterAt, glove, side);
  const reading = readModel(model, model.take_ids);
  const duration = pb.duration;
  const stageProps = {
    coach,
    gloves: glove,
    side,
    prop: shownProp(choice.prop, showProps),
    cue: showProps ? 'none' : (choice.prop ?? 'none'),
    policy: REPLAY_POLICY,
    toleranceDeg: model.tolerance.finger_angle_deg,
  } as const;

  return (
    <>
      <div className="scr-replay">
        <header className="scr-rec__top">
          <div className="scr-rec__title">
            <h2 className="scr-h2">What the apprentice will see</h2>
            <span className="note">
              {choice.name}, take {reading.referenceN}
            </span>
          </div>
          <div className="mst-seg" role="group" aria-label="Guidance view">
            {VIEWS.map((v) => (
              <Button key={v.id} variant="toggle" aria-pressed={view === v.id} title={v.hint} onClick={() => setView(v.id)}>
                {v.label}
              </Button>
            ))}
          </div>
        </header>

        <div className="scr-rec__main">
          <div className="scr-replay__col">
            <div className="scr-replay__stage">
              <ReplayStage view={view} {...stageProps} />
            </div>
            <div className="mst-replay__controls scr-transport">
              <Button variant={pb.playing ? 'primary' : 'secondary'} onClick={pb.toggle} disabled={!duration}>
                {pb.playing ? 'Pause' : 'Play'}
              </Button>
              <label className="mst-scrub">
                <span className="sr-only">Position in the take</span>
                <input type="range" min={0} max={Math.max(duration, 0.01)} step={0.01} value={Math.min(pb.position, duration)} onChange={(e) => pb.seek(Number(e.target.value))} disabled={!duration} />
                <span className="mst-scrub__time">
                  {pb.position.toFixed(1)} / {duration.toFixed(1)} s
                </span>
              </label>
              <div className="mst-seg" role="group" aria-label="Playback speed">
                {RATES.map((r) => (
                  <Button key={r} variant="toggle" aria-pressed={pb.rate === r} onClick={() => pb.setRate(r)}>
                    {r}x
                  </Button>
                ))}
              </div>
              <Button variant="toggle" aria-pressed={loop} onClick={() => setLoop((v) => !v)}>
                Loop
              </Button>
            </div>
          </div>

          <aside className="scr-rec__side scr-replay__notes">
            <p className="scr-replay__lead">{VIEWS.find((v) => v.id === view)?.hint}</p>
            <p>Take {reading.referenceN}, your reference, plays as the expert hand. The wooden hand follows whoever wears the glove, as the apprentice&rsquo;s will.</p>
            <p className="note">{fingersSentence(model)}</p>
            {loading && <p className="note">Fetching the take...</p>}
            {error && (
              <p className="mst-alert" role="alert">
                Could not load the reference take: {error.message}
              </p>
            )}
          </aside>
        </div>
      </div>

      <FlowNav
        back={{ label: 'Back to takes', onClick: onBack }}
        extra={
          <Button variant="ghost" onClick={onAddAnother}>
            Add another move
          </Button>
        }
        next={{ label: 'Next: publish', onClick: onNext }}
      />
    </>
  );
}
