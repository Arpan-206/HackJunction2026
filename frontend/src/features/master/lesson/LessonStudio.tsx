import { useParams } from 'react-router-dom';
import { api, useLesson } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { Button, ButtonLink } from '../../../components/ui';
import { LessonEditor } from '../components/LessonEditor';

/** /master/lessons/:lessonId: lesson overview and editor with an apprentice preview link. */
export function LessonStudio() {
  const { lessonId } = useParams();
  const { data: lesson, loading, error, reload } = useLesson(lessonId);

  return (
    <>
      <PageHeader kicker="Il maestro" title={lesson?.title ?? 'Lesson studio'} />
      {loading && <p className="note">Unrolling the lesson...</p>}
      {error && (
        <div className="mst-alert" role="alert">
          <p>{error.status === 404 ? 'That lesson does not exist (any more).' : `Could not load the lesson: ${error.message}`}</p>
          <Button variant="secondary" onClick={reload}>
            Try again
          </Button>
        </div>
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
