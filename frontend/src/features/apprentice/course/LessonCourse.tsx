import { useParams } from 'react-router-dom';
import type { Step } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { stepSide } from '../hooks/useReferenceTrack';
import { BackLink } from '../ApHeader';
import { ButtonLink, Card } from '../../../components/ui';
import { useLessonById } from '../hooks/useLessonData';
import { useProgress } from '../hooks/useProgress';
import { PlanCard } from './PlanCard';
import { dayKey, isDue } from '../pipeline/progress';
import { useLessonProgress } from '../pipeline/useRank';
import { RankLine } from './RankLine';
import { SealCard } from './SealCard';
import { VideoSlot } from './VideoSlot';

/** Keeps the master's own wording when it already starts "Lesson N", otherwise numbers the step. */
export function lessonTitle(step: Step, index: number): string {
  return /^lesson\s*\d+/i.test(step.title) ? step.title : `Lesson ${index + 1}: ${step.title}`;
}

const TEST_COPY = {
  table_tennis_rally: { title: 'Test your skills: the rally', blurb: 'Play a live rally. The game reads your racket face, swing and grip at the moment of contact.' },
  piano_play_along: { title: 'Test your skills: play along', blurb: 'Play a short phrase as the notes arrive. Right note, right moment, right finger.' },
} as const;

/** The course page: an ordered syllabus of lessons, each with video, hand instructions and progress, ending with the test. */
export function LessonCourse() {
  const { lessonId = '' } = useParams();
  const { data: lesson, loading, error, offline } = useLessonById(lessonId);
  const progress = useProgress(lessonId);
  const lp = useLessonProgress(lesson);
  const today = dayKey(new Date());

  if (loading) return <p className="note ap-state">Opening the course...</p>;
  if (error || !lesson) {
    return (
      <div className="ap-state">
        <PageHeader title="Lesson not found" />
        <p className="note">{error?.message ?? 'That lesson does not exist.'}</p>
        <ButtonLink to="/apprentice" variant="secondary">
          Back to lessons
        </ButtonLink>
      </div>
    );
  }

  const done = lesson.steps.filter((s) => progress.get(s.id).best >= 70).length;
  const pct = lesson.steps.length ? Math.round((done / lesson.steps.length) * 100) : 0;
  const test = lesson.test ? TEST_COPY[lesson.test.kind] : null;

  return (
    <>
      <PageHeader title={lesson.title} />
      <p className="ap-course__master">Taught by {lesson.master_name}</p>
      {lp && <RankLine rank={lp.rank} />}
      {lp?.rank === 'sealed' && <SealCard master={lesson.master_name} lesson={lesson.title} at={lp.sealedAt} score={lp.blindScore} />}
      {offline && <p className="note ap-banner">Backend offline: showing the built-in demo lesson.</p>}
      <div className="ap-course__summary">
        <p className="note ap-course__lede">{lesson.summary}</p>
        <div className="ap-course__progress" role="group" aria-label="Course progress">
          <span>
            {done} of {lesson.steps.length} lessons passed
          </span>
          <span className="ap-bar__track" role="presentation">
            <span className="ap-bar__fill ap-bar__fill--ok" style={{ width: `${pct}%` }} />
          </span>
        </div>
      </div>

      {lesson.steps.length === 0 && <p className="note ap-state">This course has no lessons yet.</p>}
      <ol className="ap-syllabus">
        {lesson.steps.map((s, i) => {
          const p = progress.get(s.id);
          return (
            <li key={s.id}>
              <Card as="article" className="ap-lesson">
                <div className="ap-lesson__media">
                  <VideoSlot url={s.video_url} title={s.title} motion={s.motion} prop={s.prop} side={stepSide(s)} />
                </div>
                <div className="ap-lesson__body">
                  <h2>{lessonTitle(s, i)}</h2>
                  <p className="ap-lesson__instruction">{s.instruction}</p>
                  <ul className="ap-meta" aria-label="Lesson details">
                    <li>{s.repetitions} repetitions</li>
                    <li>&plusmn;{s.tolerance.angle_deg}&deg; room for error</li>
                    <li>{s.reference_recording_id ? "Expert's recording" : 'Mock guide'}</li>
                  </ul>
                  <div className="ap-lesson__foot">
                    <span className="ap-lesson__prog">
                      {p.attempts === 0 ? 'Not started' : `Best ${p.best} in ${p.attempts} ${p.attempts === 1 ? 'attempt' : 'attempts'}`}
                      {p.best >= 70 && <strong className="ap-lesson__passed">Passed</strong>}
                      {lp?.steps[i]?.mastered_at && (
                        <span className="ap-lesson__mastery">{isDue(lp.steps[i], today) ? 'Mastered blind. Review due.' : `Mastered blind. Next review ${lp.steps[i].next_due}.`}</span>
                      )}
                    </span>
                    <ButtonLink to={`/apprentice/lessons/${lesson.id}/steps/${i}`} large>
                      {p.attempts === 0 ? 'Start practising' : 'Practise again'}
                    </ButtonLink>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
        {test && (
          <li>
            <Card as="article" className="ap-lesson ap-lesson--test">
              <div className="ap-lesson__body ap-lesson__body--wide">
                <h2>{test.title}</h2>
                <p className="ap-lesson__instruction">{test.blurb}</p>
                <ul className="ap-meta" aria-label="Test details">
                  <li>{lesson.test?.opponent === 'two_player' ? 'Two players, one glove each' : 'Against the bot'}</li>
                  <li>{lesson.test?.rounds} rounds</li>
                </ul>
                <div className="ap-lesson__foot">
                  <span className="ap-lesson__prog">{done < lesson.steps.length ? 'Best after the lessons, but open to everyone.' : 'You have passed every lesson.'}</span>
                  <ButtonLink to={`/apprentice/lessons/${lesson.id}/test`} large>
                    Test your skills
                  </ButtonLink>
                </div>
              </div>
            </Card>
          </li>
        )}
      </ol>
      <PlanCard lesson={lesson} />
      <div className="ap-course__back">
        <BackLink to="/apprentice">All lessons</BackLink>
      </div>
    </>
  );
}
