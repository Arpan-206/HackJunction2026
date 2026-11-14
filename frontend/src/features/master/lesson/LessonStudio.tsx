import { useParams } from 'react-router-dom';
import { api, useLesson } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { Button, ButtonLink } from '../../../components/ui';
import { LessonEditor } from '../components/LessonEditor';
import { formatWhen } from '../lib';
import { useStoredPlan } from '../../shared/practiceLog';
import { useAssistant } from '../../shared/assistant';

/** /master/lessons/:lessonId: lesson overview and editor with an apprentice preview link. */
export function LessonStudio() {
  const { lessonId } = useParams();
  const { data: lesson, loading, error, reload } = useLesson(lessonId);
  const stored = useStoredPlan(lessonId);
  const [assistant] = useAssistant();

  return (
    <>
      <PageHeader title={lesson?.title ?? 'Lesson studio'} />
      {loading && <p className="note">Unrolling the lesson...</p>}
      {error && (
        <div className="mst-alert" role="alert">
          <p>{error.status === 404 ? 'That lesson does not exist (any more).' : `Could not load the lesson: ${error.message}`}</p>
          <Button variant="secondary" onClick={reload}>
            Try again
          </Button>
        </div>
      )}
      {assistant && stored && stored.plan.master_note && (
        <aside className="mst-gen__master" aria-label="Note from the assistant">
          <h2 className="section-title">Where this apprentice struggles</h2>
          <p className="mst-gen__source">{stored.plan.master_note}</p>
          <p className="mst-gen__source">From practice on this device, planned {formatWhen(stored.at)}. It is not shared across devices.</p>
        </aside>
      )}
      {lesson && (
        <LessonEditor
          key={lesson.id}
          lesson={lesson}
          saveLabel="Save changes"
          onSave={api.updateLesson}
          extraActions={
            <ButtonLink variant="secondary" large to={`/apprentice/lessons/${lesson.id}`}>
              Preview as apprentice
            </ButtonLink>
          }
        />
      )}
    </>
  );
}
