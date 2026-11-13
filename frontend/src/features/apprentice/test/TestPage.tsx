import { useParams } from 'react-router-dom';
import { PageHeader } from '../../../components/PageHeader';
import { ButtonLink } from '../../../components/ui';
import { useLessonById } from '../hooks/useLessonData';
import { PianoPlayAlong } from './PianoPlayAlong/PianoPlayAlong';
import { TableTennisRally } from './TableTennisRally/TableTennisRally';

/** "Test your skills": the premade finale chosen by the lesson's test kind. */
export function TestPage() {
  const { lessonId } = useParams();
  const { data: lesson, loading, error, offline } = useLessonById(lessonId);

  if (loading) return <p className="note ap-state">Setting the table...</p>;
  if (error || !lesson) {
    return (
      <div className="ap-state">
        <PageHeader kicker="L'apprendista" title="Lesson not found" />
        <p className="note">{error?.message ?? 'That lesson does not exist.'}</p>
        <ButtonLink to="/apprentice" variant="secondary">
          Back to lessons
        </ButtonLink>
      </div>
    );
  }
  if (!lesson.test) {
    return (
      <div className="ap-state">
        <PageHeader kicker={lesson.title} title="No test yet" />
        <p className="note">This course has no final test. Finish the lessons and tell the master you are ready.</p>
        <ButtonLink to={`/apprentice/lessons/${lesson.id}`} variant="secondary">
          Back to the course
        </ButtonLink>
      </div>
    );
  }
  return (
    <>
      <PageHeader kicker={lesson.title} title="Test your skills" actions={<ButtonLink to={`/apprentice/lessons/${lesson.id}`} variant="ghost">Back to syllabus</ButtonLink>} />
      {offline && <p className="note ap-banner">Backend offline: playing with the built-in demo lesson.</p>}
      {lesson.test.kind === 'table_tennis_rally' ? <TableTennisRally spec={lesson.test} /> : <PianoPlayAlong spec={lesson.test} />}
    </>
  );
}
