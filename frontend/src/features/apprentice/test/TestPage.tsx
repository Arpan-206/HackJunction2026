import { useParams } from 'react-router-dom';
import { ApHeader } from '../ApHeader';
import { PageHeader } from '../../../components/PageHeader';
import { ButtonLink } from '../../../components/ui';
import { useLessonById } from '../hooks/useLessonData';
import { PianoPlayAlong } from './PianoPlayAlong/PianoPlayAlong';
import { TableTennisRally } from './TableTennisRally/TableTennisRally';
import { TypingTest } from './AirTyping/TypingTest';

/** "Test your skills": the premade finale chosen by the lesson's test kind. */
export function TestPage() {
  const { lessonId } = useParams();
  const { data: lesson, loading, error, offline } = useLessonById(lessonId);

  if (loading) return <p className="note ap-state">Setting the table...</p>;
  if (error || !lesson) {
    return (
      <div className="ap-state">
        <PageHeader title="Lesson not found" />
        <p className="note">{error?.message ?? 'That lesson does not exist.'}</p>
        <ButtonLink to="/apprentice" variant="secondary">
          Back to skills
        </ButtonLink>
      </div>
    );
  }
  if (!lesson.test) {
    return (
      <div className="ap-state">
        <PageHeader title="No test yet" />
        <p className="note">{lesson.title}</p>
        <p className="note">This course has no final test. Finish the lessons and tell the expert you are ready.</p>
        <ButtonLink to={`/apprentice/lessons/${lesson.id}`} variant="secondary">
          Back to the course
        </ButtonLink>
      </div>
    );
  }
  return (
    <>
      <ApHeader title="Test your skills" context={lesson.title} back={{ to: `/apprentice/lessons/${lesson.id}`, label: 'Back to syllabus' }} />
      {offline && <p className="note ap-banner">Backend offline: playing with the built-in demo lesson.</p>}
      {lesson.test.kind === 'table_tennis_rally' ? (
        <TableTennisRally spec={lesson.test} lesson={lesson} />
      ) : lesson.test.kind === 'air_typing' ? (
        <TypingTest spec={lesson.test} lesson={lesson} />
      ) : (
        <PianoPlayAlong spec={lesson.test} lesson={lesson} />
      )}
    </>
  );
}
