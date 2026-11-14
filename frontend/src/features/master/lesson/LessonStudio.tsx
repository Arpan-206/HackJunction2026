import { useParams } from 'react-router-dom';
import { api, useLesson } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { Button, ButtonLink } from '../../../components/ui';
import { LessonEditor } from '../components/LessonEditor';
import { RevealFile } from '../files/RevealFile';
import { SaveToFile } from '../files/SaveToFile';
import { formatWhen } from '../lib';
import { useStoredPlan } from '../../shared/practiceLog';
import { useAssistant } from '../../shared/assistant';
import { isDev } from '../../apprentice/pipeline/flags';

/** Dev only: the lesson's own file, and the newest backup bundle written to data/exports after it was published or saved. */
function LessonFiles({ lessonId }: { lessonId: string }) {
  if (!isDev()) return null;
  return (
    <div className="mst-devfiles">
      <span className="note">Lesson file</span>
      <RevealFile kind="lesson" id={lessonId} what="this lesson" />
      <span className="note">Newest backup</span>
      <RevealFile kind="export" id={lessonId} what="the newest backup of this lesson" />
    </div>
  );
}

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
        <aside className="mst-gen__master" aria-label="Note from the AI Assistant">
          <h2 className="section-title">Where this apprentice struggles</h2>
          <p className="mst-gen__source">{stored.plan.master_note}</p>
          <p className="mst-gen__source">From practice on this device, planned {formatWhen(stored.at)}. It is not shared across devices.</p>
        </aside>
      )}
      {lesson && <LessonFiles lessonId={lesson.id} />}
      {lesson && (
        <LessonEditor
          key={lesson.id}
          lesson={lesson}
          saveLabel="Save changes"
          onSave={api.updateLesson}
          extraActions={
            <>
              <ButtonLink variant="secondary" large to={`/apprentice/lessons/${lesson.id}`}>
                Preview as apprentice
              </ButtonLink>
              <SaveToFile lessonIds={[lesson.id]} name={lesson.title} />
            </>
          }
        />
      )}
    </>
  );
}
