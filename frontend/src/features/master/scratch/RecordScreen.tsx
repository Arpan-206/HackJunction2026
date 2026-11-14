import { useCallback, useEffect, useState } from 'react';
import type { GloveStreamHandle, Hands, TakesModel } from '../../../api';
import { Button, Disclosure } from '../../../components/ui';
import { PropSwitch } from '../../shared/PropSwitch';
import { RobotStudioPane } from '../../shared/robot/RobotStudioPane';
import { shownProp, useShowProps } from '../../shared/sessionPrefs';
import { useCalibration } from '../../shared/useCalibration';
import { CountdownRecord } from '../components/CountdownRecord';
import { FingerLanes } from '../components/FingerLanes';
import { LiveHandStage } from '../components/LiveHandStage';
import { SteadinessControl } from '../components/SteadinessControl';
import { useRecorder } from '../hooks/useRecorder';
import type { SteadinessHandle } from '../hooks/useSteadiness';
import { formatDuration, primarySide, type MoveChoice } from '../lib';
import { RevealFile } from '../files/RevealFile';
import { FlowNav } from './FlowNav';
import { GlovesControl } from './GlovesControl';
import { HANDS_SHORT, handsOptions, readModel, TAKE_WORD_LABEL, TAKES_MAX, TAKES_TARGET, repStepId, type ModelReading } from './scratchDraft';
import { useMoveTakes, type MoveTake } from './useMoveTakes';
import { useTakePlayback, type TakePlayback } from './useTakePlayback';

interface RecordScreenProps {
  choice: MoveChoice;
  /** Which move of the new skill this is (1 for the first). */
  moveNumber: number;
  /** The skill this lesson is for, when it was started from that skill's page; null for a new skill. */
  forSkill: string | null;
  /** This move's take ids saved with the draft, and where to save them as they change. */
  takeIds: string[];
  onTakeIds: (ids: string[]) => void;
  glove: GloveStreamHandle;
  steadiness: SteadinessHandle;
  model: TakesModel | null;
  onModel: (m: TakesModel | null) => void;
  onHands: (h: Hands) => void;
  /** Back to Publish, when earlier moves of the skill are waiting there. */
  onBack?: () => void;
  onNext: () => void;
}

/** "Take 2 of 3", then the optional fourth and fifth; while a take runs it names that take. */
function counterLine(count: number, running: boolean): string {
  if (running) return `Recording take ${count + 1}`;
  if (count < TAKES_TARGET) return `Take ${count + 1} of ${TAKES_TARGET}`;
  return `${count} takes recorded`;
}

function TakeCounter({ count, running }: { count: number; running: boolean }) {
  return (
    <div className="scr-count">
      <p className="scr-count__line" aria-live="polite">
        {counterLine(count, running)}
      </p>
      <div className="scr-count__dots" aria-hidden="true">
        {Array.from({ length: TAKES_MAX }, (_, i) => (
          <span key={i} className={`scr-dot${i < count ? ' is-on' : ''}${i >= TAKES_TARGET ? ' scr-dot--extra' : ''}`} />
        ))}
      </div>
      {count < TAKES_TARGET && (
        <p className="note">
          Record the move {TAKES_TARGET} times. Up to {TAKES_MAX} if you like.
        </p>
      )}
    </div>
  );
}

interface TakeStripProps {
  takes: MoveTake[];
  reading: ModelReading | null;
  busy: boolean;
  /** The take playing on the stage, if any. */
  watching: string | null;
  onWatch: (id: string | null) => void;
  onRedo: (id: string) => void;
  onDelete: (id: string) => void;
}

/** The takes so far, one compact row each: number, length, how it compares once modelled, Watch, Redo and Delete. */
function TakeStrip({ takes, reading, busy, watching, onWatch, onRedo, onDelete }: TakeStripProps) {
  const [confirming, setConfirming] = useState<string | null>(null);
  if (!takes.length) return null;
  return (
    <ol className="scr-takes" aria-label="Takes">
      {takes.map((t, i) => {
        const r = reading?.takes.find((x) => x.id === t.id);
        return (
          <li key={t.id} className={`scr-take${r?.outlier ? ' scr-take--off' : ''}${watching === t.id ? ' scr-take--watching' : ''}`}>
            <span className="scr-take__head">
              <span className="scr-take__n">Take {i + 1}</span>
              <span className="scr-take__len">{formatDuration(t.duration_s)}</span>
            </span>
            {r && (
              <span className={`scr-take__word scr-take__word--${r.word}`} title={r.isReference ? undefined : `${r.score} of 100 against the reference`}>
                {TAKE_WORD_LABEL[r.word]}
              </span>
            )}
            <span className="scr-take__actions">
              {confirming === t.id ? (
                <span className="scr-take__confirm" role="group" aria-label={`Delete take ${i + 1}?`}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setConfirming(null);
                      onDelete(t.id);
                    }}
                  >
                    Delete
                  </Button>
                  <Button variant="ghost" autoFocus onClick={() => setConfirming(null)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <>
                  <Button variant="ghost" disabled={busy} aria-pressed={watching === t.id} onClick={() => onWatch(watching === t.id ? null : t.id)} aria-label={`Watch take ${i + 1}`}>
                    Watch
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => onRedo(t.id)} aria-label={`Redo take ${i + 1}`}>
                    Redo
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setConfirming(t.id)} aria-label={`Delete take ${i + 1}`}>
                    Delete
                  </Button>
                </>
              )}
            </span>
            <RevealFile kind="recording" id={t.id} what={`take ${i + 1}`} className="scr-take__file" />
          </li>
        );
      })}
    </ol>
  );
}

interface TakeTransportProps {
  n: number;
  play: TakePlayback;
  /** How this take compares, once the takes are modelled. */
  word: string | null;
  outlier: boolean;
  isReference: boolean;
  compare: boolean;
  canCompare: boolean;
  onCompare: (on: boolean) => void;
  onRedo: () => void;
  onLive: () => void;
  busy: boolean;
}

/** Under the stage while a take plays: play or pause, scrub, compare with the reference, redo, and back to the live hand. */
function TakeTransport({ n, play, word, outlier, isReference, compare, canCompare, onCompare, onRedo, onLive, busy }: TakeTransportProps) {
  const { pb } = play;
  const d = pb.duration;
  return (
    <section className="scr-watch" aria-label={`Take ${n}, played back`}>
      <div className="mst-replay__controls scr-transport">
        <Button variant={pb.playing ? 'primary' : 'secondary'} onClick={pb.toggle} disabled={!d}>
          {pb.playing ? 'Pause' : 'Play'}
        </Button>
        <label className="mst-scrub">
          <span className="sr-only">Position in take {n}</span>
          <input type="range" min={0} max={Math.max(d, 0.01)} step={0.01} value={Math.min(pb.position, d)} onChange={(e) => pb.seek(Number(e.target.value))} disabled={!d} />
          <span className="mst-scrub__time">
            {pb.position.toFixed(1)} / {d.toFixed(1)} s
          </span>
        </label>
        <Button variant="secondary" onClick={onLive}>
          Back to live
        </Button>
      </div>
      <div className="scr-watch__verdict">
        {play.loading && <p className="note">Fetching take {n}...</p>}
        {play.error && (
          <p className="mst-alert" role="alert">
            Could not load take {n}: {play.error}
          </p>
        )}
        {word && <p className="scr-watch__word">{isReference ? `Take ${n} is your reference.` : `Take ${n}: ${word.toLowerCase()}.`}</p>}
        {outlier && <p>Take {n} strays from the others. Record this one again?</p>}
        <div className="scr-watch__acts">
          {canCompare && (
            <Button variant="toggle" aria-pressed={compare} onClick={() => onCompare(!compare)}>
              Compare with reference
            </Button>
          )}
          <Button variant={outlier ? 'primary' : 'secondary'} disabled={busy} onClick={onRedo}>
            Record take {n} again
          </Button>
        </div>
      </div>
    </section>
  );
}

/** The takes model in plain words: which take teaches, how alike the takes are, a gentle redo for a stray take. */
function ModelSummary({ reading, consistency, onRedo, busy }: { reading: ModelReading; consistency: number; onRedo: (id: string) => void; busy: boolean }) {
  return (
    <section className="scr-model" aria-label="How your takes compare">
      <h3 className="scr-model__ref">Take {reading.referenceN} is your reference.</h3>
      <p>
        {reading.headline} <span className="note">Consistency {Math.round(consistency)} of 100.</span>
      </p>
      <p className="note">{reading.fingers}</p>
      {reading.outliers.map((o) => (
        <div key={o.id} className="scr-model__redo">
          <p>Take {o.n} strays from the others. Record this one again?</p>
          <Button variant="secondary" disabled={busy} onClick={() => onRedo(o.id)}>
            Record take {o.n} again
          </Button>
        </div>
      ))}
    </section>
  );
}

/**
 * Record: the live hand as the hero, one record button with its 3-2-1 countdown, a take counter towards three takes,
 * the take strip, then the takes model in plain words. Gloves, signal and the robot stay folded away.
 */
export function RecordScreen({ choice, moveNumber, forSkill, takeIds, onTakeIds, glove, steadiness, model, onModel, onHands, onBack, onNext }: RecordScreenProps) {
  const [showProps] = useShowProps();
  const side = primarySide(choice.hands);
  const cal = useCalibration(side);
  const t = useMoveTakes({ savedIds: takeIds, hands: choice.hands, initialModel: model, onModel, onIds: onTakeIds });
  const recorder = useRecorder((rec) => t.add(rec));
  const [showJoints, setShowJoints] = useState(false);
  const [showTrails, setShowTrails] = useState(false);
  const [busy, setBusy] = useState(false);
  // A take played back on the stage in place of the live hand, and whether the reference lies over it as a ghost.
  const [watching, setWatching] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const count = t.takes.length;
  const running = recorder.phase !== 'idle';
  const options = handsOptions(choice);
  // The hands are asked once, before the first take; after that every take must match.
  const asking = options.length > 0 && count === 0 && !running;
  const reading = t.model ? readModel(t.model, t.takes.map((x) => x.id)) : null;
  const watchedN = watching ? t.takes.findIndex((x) => x.id === watching) + 1 : 0;
  const watchedRead = reading?.takes.find((x) => x.id === watching) ?? null;
  const refId = t.model?.reference_recording_id ?? null;
  const canCompare = Boolean(refId && watching && refId !== watching);
  const play = useTakePlayback(watchedN ? watching : null, canCompare && compare ? refId : null);
  // Recording always shows the live hand: a countdown (from Record or Redo) stops any playback first.
  useEffect(() => {
    if (running) setWatching(null);
  }, [running]);
  // A deleted take stops playing.
  useEffect(() => {
    if (watching && !watchedN && !t.loading) setWatching(null);
  }, [watching, watchedN, t.loading]);
  const watch = (id: string | null) => {
    setWatching(id);
    if (id) play.pb.play();
  };
  // Each take is labelled `<move_id>:rep<n>`, the training-data convention; a redone take keeps its number.
  const ctx = { stepId: repStepId(choice.id, t.nextRep), hands: choice.hands };

  const redo = useCallback(
    async (id: string) => {
      const rep = t.takes.find((x) => x.id === id)?.rep || t.nextRep;
      setBusy(true);
      await t.remove(id);
      setBusy(false);
      recorder.begin({ stepId: repStepId(choice.id, rep), hands: choice.hands });
    },
    [t, recorder, choice.id, choice.hands],
  );
  const del = useCallback(
    async (id: string) => {
      setBusy(true);
      await t.remove(id);
      setBusy(false);
    },
    [t],
  );

  const ready = Boolean(t.model) && !running;
  const reason = count < TAKES_TARGET ? `Record ${TAKES_TARGET - count} more ${TAKES_TARGET - count === 1 ? 'take' : 'takes'} to continue.` : t.modelling ? 'Comparing your takes...' : undefined;

  return (
    <>
      <div className="scr-rec">
        <header className="scr-rec__top">
          <div className="scr-rec__title">
            <h2 className="scr-h2">{moveNumber > 1 ? `Record move ${moveNumber}` : 'Record your move'}</h2>
            <span className="note">
              {moveNumber > 1
                ? 'Your earlier moves are kept. Name them all when you publish.'
                : forSkill
                  ? `A new lesson for ${forSkill}. You name the move when you publish.`
                  : 'A new skill, in your own hands. You name it when you publish.'}
            </span>
          </div>
          <div className="scr-rec__tools">
            {!asking && <span className="scr-hands__fixed">{HANDS_SHORT[choice.hands]}</span>}
            <GlovesControl glove={glove} source={steadiness.gloveSource} side={side} cal={cal} />
          </div>
        </header>

        <div className="scr-rec__main">
          <div className="scr-rec__stage">
            <LiveHandStage firstPerson glove={glove} showJoints={showJoints} showTrails={showTrails} prop={shownProp(choice.prop, showProps)} hands={choice.hands} live={recorder.phase === 'recording'} playback={watching ? play.stage : null}>
              {watching && watchedN > 0 && (
                <p className="scr-watch__caption">
                  Take {watchedN}, played back{compare && canCompare ? ', the reference as a ghost' : ''}
                </p>
              )}
            </LiveHandStage>
            {watching && watchedN > 0 && (
              <TakeTransport
                n={watchedN}
                play={play}
                word={watchedRead ? TAKE_WORD_LABEL[watchedRead.word] : null}
                outlier={Boolean(watchedRead?.outlier)}
                isReference={Boolean(watchedRead?.isReference)}
                compare={compare}
                canCompare={canCompare}
                onCompare={setCompare}
                onRedo={() => void redo(watching)}
                onLive={() => setWatching(null)}
                busy={busy}
              />
            )}
          </div>

          <div className="scr-rec__side">
            {asking && (
              <fieldset className="scr-ask">
                <legend className="scr-ask__q">Which hands will you use?</legend>
                <div className="mst-seg scr-hands" role="group" aria-label="Hands">
                  {options.map((h) => (
                    <Button key={h} variant="toggle" aria-pressed={choice.hands === h} onClick={() => onHands(h)}>
                      {HANDS_SHORT[h]}
                    </Button>
                  ))}
                </div>
              </fieldset>
            )}
            <TakeCounter count={count} running={recorder.phase === 'recording'} />
            <div className="scr-rec__button">
              {count >= TAKES_TARGET && !running ? (
                // Three takes teach the move, so Next becomes the main action; a fourth or fifth take is a quieter offer.
                <Button variant="secondary" onClick={() => recorder.begin(ctx)} disabled={count >= TAKES_MAX || busy}>
                  {count >= TAKES_MAX ? `${TAKES_MAX} takes is the most a lesson uses` : `Record take ${count + 1} (optional)`}
                </Button>
              ) : (
                <CountdownRecord recorder={recorder} context={ctx} disabled={count >= TAKES_MAX || busy || t.loading} caption="Begin the move on zero" />
              )}
            </div>
            {recorder.error && (
              <p className="mst-alert mst-alert--error" role="alert">
                {recorder.error}
              </p>
            )}
            {t.error && (
              <p className="mst-alert mst-alert--error" role="alert">
                {t.error}
              </p>
            )}
            {t.modelling && !reading && <p className="note">Comparing your takes...</p>}
            {reading && t.model && <ModelSummary reading={reading} consistency={t.model.consistency} busy={busy || running} onRedo={(id) => void redo(id)} />}
            <TakeStrip takes={t.takes} reading={reading} busy={busy || running} watching={watching} onWatch={watch} onRedo={(id) => void redo(id)} onDelete={(id) => void del(id)} />
          </div>
        </div>

        <Disclosure summary="View, signal and robot" className="scr-more">
          <div className="mst-toggles" role="group" aria-label="Live view options">
            <Button variant="toggle" aria-pressed={showJoints} onClick={() => setShowJoints(!showJoints)}>
              Joint rings
            </Button>
            <Button variant="toggle" aria-pressed={showTrails} onClick={() => setShowTrails(!showTrails)}>
              Fingertip trails
            </Button>
          </div>
          {choice.prop !== 'none' && <PropSwitch prop={choice.prop} />}
          <FingerLanes getHand={() => glove.latest.current?.hands.find((h) => h.side === side) ?? glove.latest.current?.hands[0] ?? null} />
          <SteadinessControl control={steadiness} />
          <RobotStudioPane glove={glove} side={side} />
        </Disclosure>
      </div>

      <FlowNav back={onBack ? { label: 'Back to publish', onClick: onBack, disabled: running } : undefined} next={{ label: 'Next: replay', onClick: onNext, disabled: !ready, reason }} />
    </>
  );
}

