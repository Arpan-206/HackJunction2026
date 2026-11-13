import { useState, type ReactNode } from 'react';
import { ApiError, type Lesson } from '../../../api';
import { Badge, Button, Card, Field, TextArea, useToast } from '../../../components/ui';
import { useLessonDraft } from '../hooks/useLessonDraft';
import { useTakeBook } from '../hooks/useTakeBook';
import { primarySide, skillLabel } from '../lib';
import { Modal } from './Modal';
import { ReplayPlayer } from './ReplayPlayer';
import { StepEditor } from './StepEditor';
import { StepRecorderDialog } from './StepRecorderDialog';
import { TestSettings } from './TestSettings';

interface LessonEditorProps {
  lesson: Lesson;
  /** Persists the draft; resolves to the saved lesson. Errors are shown inline. */
  onSave: (lesson: Lesson) => Promise<Lesson>;
  saveLabel: string;
  /** Extra actions next to the save button, e.g. the apprentice preview link. */
  extraActions?: ReactNode;
}

/**
 * Edits one lesson: details, a list of steps (each with guide hand, record and replay), the finale settings and save.
 * Used for generated drafts and for saved lessons alike.
 */
export function LessonEditor({ lesson, onSave, saveLabel, extraActions }: LessonEditorProps) {
  const toast = useToast();
  const d = useLessonDraft(lesson);
  const book = useTakeBook();
  const [recording, setRecording] = useState<string | null>(null);
  const [replay, setReplay] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { draft } = d;
  const recStep = draft.steps.find((s) => s.id === recording) ?? null;
  const replayStep = draft.steps.find((s) => s.id === replay) ?? null;
  const recorded = draft.steps.filter((s) => s.reference_recording_id).length;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      d.commit(await onSave(draft));
      toast.show('Lesson saved.', 'ok');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card className="mst-details">
        <div className="mst-details__grid">
          <Field label="Lesson title" value={draft.title} onChange={(e) => d.patch({ title: e.target.value })} />
          <Field label="Master" value={draft.master_name} onChange={(e) => d.patch({ master_name: e.target.value })} />
        </div>
        <TextArea label="Summary" rows={2} value={draft.summary} onChange={(e) => d.patch({ summary: e.target.value })} />
        <div className="mst-details__meta">
          <Badge tone="lapis">{skillLabel(draft.skill)}</Badge>
          <Badge>{draft.source}</Badge>
          <Badge tone={recorded === draft.steps.length && recorded > 0 ? 'ok' : 'neutral'}>
            {recorded} of {draft.steps.length} steps in your own hand
          </Badge>
        </div>
      </Card>

      <h2 className="section-title">Steps</h2>
      {draft.steps.length === 0 && <p className="note">This lesson has no steps yet. Add one below.</p>}
      <ol className="mst-steps">
        {draft.steps.map((s, i) => (
          <StepEditor
            key={s.id}
            step={s}
            index={i}
            count={draft.steps.length}
            onChange={(f) => d.updateStep(s.id, f)}
            onMove={(delta) => d.moveStep(s.id, delta)}
            onDelete={() => d.removeStep(s.id)}
            onRecord={() => setRecording(s.id)}
            onReplay={() => setReplay(s.id)}
          />
        ))}
      </ol>
      <Button variant="secondary" onClick={d.addStep}>
        Add a step
      </Button>

      <TestSettings skill={draft.skill} test={draft.test} onChange={d.setTest} />

      <div className="mst-savebar">
        {error && (
          <p className="mst-alert" role="alert">
            {error}
          </p>
        )}
        <Button large onClick={() => void save()} disabled={saving || draft.steps.length === 0}>
          {saving ? 'Saving...' : saveLabel}
        </Button>
        {extraActions}
        {!d.dirty && <span className="note">Nothing unsaved.</span>}
      </div>

      {recStep && (
        <StepRecorderDialog
          step={recStep}
          lessonId={draft.id}
          book={book}
          onReference={(id) => d.updateStep(recStep.id, { reference_recording_id: id })}
          onClose={() => setRecording(null)}
        />
      )}
      {replayStep?.reference_recording_id && (
        <Modal title={`Replay: ${replayStep.title}`} onClose={() => setReplay(null)} wide>
          <ReplayPlayer items={[{ id: replayStep.reference_recording_id, label: 'Your take' }]} side={primarySide(replayStep.hands)} prop={replayStep.prop} />
        </Modal>
      )}
    </>
  );
}
