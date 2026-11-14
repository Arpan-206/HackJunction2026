import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../../../components/PageHeader';
import { Button, Card, Disclosure, Field, Stepper } from '../../../components/ui';
import { CalibrationPanel } from '../../shared/CalibrationPanel';
import { PropSwitch } from '../../shared/PropSwitch';
import { handsLabel, shownProp, useShowProps } from '../../shared/sessionPrefs';
import { prefersReducedMotion } from '../../shared/settings';
import { FingerLanes } from '../components/FingerLanes';
import { HandsControl } from '../components/HandsControl';
import { LiveHandStage } from '../components/LiveHandStage';
import { MovePicker } from '../components/MovePicker';
import { RecorderPanel } from '../components/RecorderPanel';
import { ReplayPlayer } from '../components/ReplayPlayer';
import { SteadinessControl } from '../components/SteadinessControl';
import type { RecorderPhase } from '../hooks/useRecorder';
import { primarySide } from '../lib';
import { useScratchStudio } from './useScratchStudio';
import { RobotStudioPane } from '../../shared/robot/RobotStudioPane';

/** "Start from scratch": pick a move, calibrate, record takes against a live 3D hand, then save a lesson. */
export function ScratchStudio() {
  const s = useScratchStudio();
  const [recPhase, setRecPhase] = useState<RecorderPhase>('idle');
  const [picking, setPicking] = useState(true);
  const [showProps] = useShowProps();
  const stageTop = useRef<HTMLElement>(null);
  const { choice, glove } = s;
  const takes = choice ? s.book.takesFor(choice.id) : [];
  const replayItems = (s.replay ?? []).map((id) => ({ id, label: `Take ${takes.find((t) => t.id === id)?.n ?? ''}`.trim() }));
  const stage = !choice ? 0 : s.planned.length ? 2 : 1;
  const prop = shownProp(choice?.prop, showProps);
  // Once a take exists (or one is recording) the hands are fixed for this move, so every take matches the lesson step.
  const handsLocked = takes.length > 0 || recPhase !== 'idle' ? "Set for this move's takes. Delete them to change it." : null;

  const choose: typeof s.choose = (c) => {
    s.choose(c);
    setPicking(false);
  };

  const choiceId = choice?.id;
  useEffect(() => {
    if (!choiceId) return;
    const reduce = prefersReducedMotion();
    stageTop.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, [choiceId]);

  return (
    <>
      <PageHeader title="Start from scratch" context="Choose a move, capture takes with your glove, then publish them as a lesson." />
      <div className="mst-steps-bar">
        <Stepper label="Progress" current={stage} steps={[{ label: 'Choose' }, { label: 'Capture' }, { label: 'Publish' }]} />
      </div>

      <section className="mst-section" aria-labelledby="mst-pick">
        <h2 id="mst-pick" className="sr-only">
          Choose a move
        </h2>
        {choice && !picking ? (
          <p className="mst-chosen">
            <span className="mst-chosen__name">{choice.name}</span>
            <span className="note">{handsLabel(choice.hands).toLowerCase()}</span>
            <Button variant="secondary" onClick={() => setPicking(true)}>
              Change move
            </Button>
          </p>
        ) : (
          <MovePicker catalogue={s.catalogue} skill={s.skill} onSkill={s.setSkill} choice={choice} onChoose={choose} />
        )}
      </section>

      <section className="mst-section" aria-labelledby="mst-rec" ref={stageTop}>
        <h2 id="mst-rec" className="sr-only">
          Calibrate and record
        </h2>
        <div className="mst-studio">
          <div className="mst-studio__view">
            {s.replay ? (
              <ReplayPlayer items={replayItems} side={primarySide(choice?.hands ?? 'right')} hands={choice?.hands} prop={prop} onClose={() => s.setReplay(null)} />
            ) : (
              <>
                <LiveHandStage glove={glove} showJoints={s.showJoints} showTrails={s.showTrails} prop={prop} hands={choice?.hands} live={recPhase === 'recording'}>
                  {choice && <span className="mst-stage__tag">{choice.name}</span>}
                </LiveHandStage>
                <RobotStudioPane glove={glove} side={s.side} />
                {glove.status !== 'open' && (
                  <p className="mst-alert" role="status">
                    The glove stream is not connected. Is the backend running on port 8000? The hand shows a resting pose until it is.
                  </p>
                )}
                <Disclosure summary="Signal" className="mst-signal">
                  <div className="mst-toggles" role="group" aria-label="Live view options">
                    <Button variant="toggle" aria-pressed={s.showJoints} onClick={() => s.setShowJoints(!s.showJoints)}>
                      Joint rings
                    </Button>
                    <Button variant="toggle" aria-pressed={s.showTrails} onClick={() => s.setShowTrails(!s.showTrails)}>
                      Fingertip trails
                    </Button>
                  </div>
                  <FingerLanes getHand={() => glove.latest.current?.hands.find((h) => h.side === s.side) ?? glove.latest.current?.hands[0] ?? null} />
                  <SteadinessControl control={s.steadiness} />
                </Disclosure>
              </>
            )}
          </div>

          <div className="mst-studio__side">
            {choice && (
              <Card title="Set up" className="mst-setup">
                <HandsControl value={choice.hands} onChange={s.setHands} locked={handsLocked} />
                <PropSwitch prop={choice.prop} />
              </Card>
            )}
            {choice ? (
              <RecorderPanel
                slot={choice.id}
                title={`Takes: ${choice.name}`}
                targetReps={choice.repetitions}
                book={s.book}
                contextFor={(rep) => ({ stepId: `${choice.id}:rep${rep}`, hands: choice.hands })}
                onReplay={s.setReplay}
                onPhase={setRecPhase}
              />
            ) : (
              <Card title="Record a take">
                <p className="note">Choose a move above first. Your takes will be labelled with the move and repetition number.</p>
              </Card>
            )}
            <CalibrationPanel side={s.side} onSide={s.setSide} cal={s.calibration} hideSide={Boolean(choice) && choice?.hands !== 'both'} />
          </div>
        </div>
      </section>

      <section className="mst-section" aria-labelledby="mst-save">
        <h2 id="mst-save" className="mst-h">
          Save as lesson
        </h2>
        <Card className="mst-save">
          {s.planned.length === 0 ? (
            <p className="note">Keep at least one take of a move and it joins the lesson plan here.</p>
          ) : (
            <ol className="mst-plan" aria-label="Lesson plan">
              {s.planned.map((c) => (
                <li key={c.id}>
                  <strong>{c.name}</strong> <span className="note">{((n) => `${n} ${n === 1 ? 'take' : 'takes'} kept`)(s.book.takesFor(c.id).filter((t) => t.kept).length)}</span>
                </li>
              ))}
            </ol>
          )}
          <div className="mst-save__fields">
            <Field label="Lesson title" value={s.title} onChange={(e) => s.setTitle(e.target.value)} placeholder="Forehand basics" />
            <Field label="Your name" value={s.masterName} onChange={(e) => s.setMasterName(e.target.value)} placeholder="Expert name" />
          </div>
          {s.saveError && (
            <p className="mst-alert mst-alert--error" role="alert">
              {s.saveError}
            </p>
          )}
          <div className="mst-recbtn-wrap">
            <Button large onClick={() => void s.save()} disabled={s.planned.length === 0 || s.saving}>
              {s.saving ? 'Saving...' : 'Save as lesson'}
            </Button>
            {s.planned.length === 0 && <span className="reason">Keep one take to save.</span>}
          </div>
        </Card>
      </section>
    </>
  );
}
