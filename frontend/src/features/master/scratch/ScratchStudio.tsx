import { useState } from 'react';
import { PageHeader } from '../../../components/PageHeader';
import { Badge, Button, Card, Field } from '../../../components/ui';
import { CalibrationPanel } from '../components/CalibrationPanel';
import { FingerLanes } from '../components/FingerLanes';
import { LiveHandStage } from '../components/LiveHandStage';
import { MovePicker } from '../components/MovePicker';
import { RecorderPanel } from '../components/RecorderPanel';
import { ReplayPlayer } from '../components/ReplayPlayer';
import { SteadinessControl } from '../components/SteadinessControl';
import type { RecorderPhase } from '../hooks/useRecorder';
import { primarySide } from '../lib';
import { useScratchStudio } from './useScratchStudio';

/** "Start from scratch": pick a move, calibrate, record takes against a live 3D hand, then save a lesson. */
export function ScratchStudio() {
  const s = useScratchStudio();
  const [recPhase, setRecPhase] = useState<RecorderPhase>('idle');
  const { choice, glove } = s;
  const takes = choice ? s.book.takesFor(choice.id) : [];
  const replayItems = (s.replay ?? []).map((id) => ({ id, label: `Take ${takes.find((t) => t.id === id)?.n ?? ''}`.trim() }));
  const source = s.steadiness.gloveSource;

  return (
    <>
      <PageHeader kicker="Il maestro" title="Start from scratch" />

      <section className="mst-section" aria-labelledby="mst-pick">
        <h2 id="mst-pick" className="mst-h">
          <span className="mst-h__n">I</span> Choose a move
        </h2>
        <MovePicker catalogue={s.catalogue} skill={s.skill} onSkill={s.setSkill} choice={choice} onChoose={s.choose} />
      </section>

      <section className="mst-section" aria-labelledby="mst-rec">
        <h2 id="mst-rec" className="mst-h">
          <span className="mst-h__n">II</span> Calibrate and record
        </h2>
        <div className="mst-studio">
          <div className="mst-studio__view">
            {s.replay ? (
              <ReplayPlayer items={replayItems} side={primarySide(choice?.hands ?? 'right')} prop={choice?.prop} onClose={() => s.setReplay(null)} />
            ) : (
              <>
                <LiveHandStage glove={glove} showJoints={s.showJoints} showTrails={s.showTrails} prop={choice?.prop}>
                  <Badge tone={glove.status === 'open' ? 'ok' : 'neutral'}>
                    {glove.status === 'open' ? (source === 'simulator' ? 'Simulator hand' : 'Glove live') : glove.status === 'connecting' ? 'Connecting...' : 'No glove stream'}
                  </Badge>
                  {choice && <Badge tone="lapis">{choice.name}</Badge>}
                  {recPhase === 'recording' && <span className="mst-recmark">REC</span>}
                </LiveHandStage>
                <div className="mst-toggles" role="group" aria-label="Live view options">
                  <Button variant={s.showJoints ? 'primary' : 'secondary'} aria-pressed={s.showJoints} onClick={() => s.setShowJoints(!s.showJoints)}>
                    Joint rings
                  </Button>
                  <Button variant={s.showTrails ? 'primary' : 'secondary'} aria-pressed={s.showTrails} onClick={() => s.setShowTrails(!s.showTrails)}>
                    Fingertip trails
                  </Button>
                </div>
                {glove.status !== 'open' && (
                  <p className="mst-alert" role="status">
                    The glove stream is not connected. Is the backend running on port 8000? The hand shows a resting pose until it is.
                  </p>
                )}
                <FingerLanes getHand={() => glove.latest.current?.hands.find((h) => h.side === s.side) ?? glove.latest.current?.hands[0] ?? null} />
              </>
            )}
          </div>

          <div className="mst-studio__side">
            <CalibrationPanel side={s.side} onSide={s.setSide} cal={s.calibration} />
            {choice ? (
              <RecorderPanel
                slot={choice.id}
                title={`Record: ${choice.name}`}
                targetReps={choice.repetitions}
                book={s.book}
                contextFor={(rep) => ({ stepId: `${choice.id}:rep${rep}` })}
                onReplay={s.setReplay}
                onPhase={setRecPhase}
              />
            ) : (
              <Card title="Record a take">
                <p className="note">Choose a move above first. Your takes will be labelled with the move and repetition number.</p>
              </Card>
            )}
            <SteadinessControl control={s.steadiness} />
          </div>
        </div>
      </section>

      <section className="mst-section" aria-labelledby="mst-save">
        <h2 id="mst-save" className="mst-h">
          <span className="mst-h__n">III</span> Save as lesson
        </h2>
        <Card className="mst-save">
          {s.planned.length === 0 ? (
            <p className="note">Keep at least one take of a move and it joins the lesson plan here.</p>
          ) : (
            <ol className="mst-plan" aria-label="Lesson plan">
              {s.planned.map((c) => (
                <li key={c.id}>
                  <strong>{c.name}</strong> <span className="note">{s.book.takesFor(c.id).filter((t) => t.kept).length} takes kept</span>
                </li>
              ))}
            </ol>
          )}
          <div className="mst-save__fields">
            <Field label="Lesson title" value={s.title} onChange={(e) => s.setTitle(e.target.value)} placeholder="Forehand basics" />
            <Field label="Your name" value={s.masterName} onChange={(e) => s.setMasterName(e.target.value)} placeholder="Master name" />
          </div>
          {s.saveError && (
            <p className="mst-alert" role="alert">
              {s.saveError}
            </p>
          )}
          <Button large onClick={() => void s.save()} disabled={s.planned.length === 0 || s.saving}>
            {s.saving ? 'Saving...' : 'Save as lesson'}
          </Button>
        </Card>
      </section>
    </>
  );
}
