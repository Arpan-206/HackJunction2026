import { useParams } from 'react-router-dom';
import { tutorialVideoOf, type Lesson, type Step } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { stepSide } from '../hooks/useReferenceTrack';
import { BackLink } from '../ApHeader';
import { ButtonLink, Card } from '../../../components/ui';
import { useLessonById } from '../hooks/useLessonData';
import { useProgress } from '../hooks/useProgress';
import { PlanCard } from './PlanCard';
import { dayKey, formatDueDay, isDue } from '../pipeline/progress';
import { useLoggedAttempts } from '../../shared/practiceLog';
import { useLessonProgress } from '../pipeline/useRank';
import { RankLine } from './RankLine';
import { SealCard } from './SealCard';
import { VideoSlot } from './VideoSlot';
import { shownProp, useShowProps } from '../../shared/sessionPrefs';
import { skillName, skillPath } from '../skills/catalogue';
import { JOURNEY, JOURNEY_LABEL, playRecord, tutorialsSeen, type JourneyPart } from '../pipeline/journey';
import { PLAY_CALLS } from '../play/PlayPage';

/** Keeps the master's own wording when it already starts "Lesson N", otherwise numbers the step. */
export function lessonTitle(step: Step, index: number): string {
  return /^lesson\s*\d+/i.test(step.title) ? step.title : `Lesson ${index + 1}: ${step.title}`;
}

const TEST_COPY = {
  table_tennis_rally: { title: 'Play: the rally', blurb: 'Play a live rally. The game reads your racket face, swing and grip at the moment of contact.' },
  piano_play_along: { title: 'Play: play along', blurb: 'Play a short phrase as the notes arrive. Right note, right moment, right finger.' },
  air_typing: { title: 'Play: air typing', blurb: 'Type short words in the air, or on a real keyboard. The gloves check that every letter is struck by the right finger.' },
} as const;

/** The Play card for a course without a premade game: the generic round of called moves. */
const PLAY_COPY = {
  title: 'Play: try your skill in real time',
  blurb: 'The moves of this course are called one after another, without the expert. Make each one when it is called; the score fills as you hold it.',
};

/** The three parts of a course as a ledger line, numbered like the practice ladder: done parts in malachite, the next underlined. */
function JourneyLine({ done }: { done: Record<JourneyPart, boolean> }) {
  const now = JOURNEY.find((p) => !done[p]) ?? null;
  return (
    <ol className="ap-ladder__rungs ap-journey" aria-label="The three parts of this course">
      {JOURNEY.map((p, i) => (
        <li key={p} className={done[p] ? 'is-done' : p === now ? 'is-now' : ''} aria-current={p === now ? 'step' : undefined}>
          <span className="ap-ladder__n" aria-hidden="true">
            {i + 1}
          </span>
          {JOURNEY_LABEL[p]}
        </li>
      ))}
    </ol>
  );
}

/** What the journey line counts as done: every tutorial watched (or its practice begun), every lesson mastered, a round played. */
function journeyDone(lesson: Lesson, steps: { attempts: number; done: boolean }[]): Record<JourneyPart, boolean> {
  const seen = tutorialsSeen(lesson.id);
  return {
    tutorial: lesson.steps.length > 0 && lesson.steps.every((s, i) => seen.has(s.id) || steps[i].attempts > 0),
    practice: steps.length > 0 && steps.every((s) => s.done),
    play: playRecord(lesson.id) !== null,
  };
}

/** The course page: an ordered syllabus of lessons, each with video, hand instructions and progress, ending with the test. */
export function LessonCourse() {
  const { lessonId = '' } = useParams();
  const { data: lesson, loading, error, offline } = useLessonById(lessonId);
  const progress = useProgress(lessonId);
  const logged = useLoggedAttempts(lessonId);
  const lp = useLessonProgress(lesson);
  const [showProps] = useShowProps();
  const today = dayKey(new Date());

  if (loading) return <p className="note ap-state">Opening the course...</p>;
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

  // One source of truth with the rank and the seal: the pipeline's practice log (with the older per-step store as a fallback
  // for attempts made before the log existed). A lesson is done once it is mastered blind.
  const stepState = lesson.steps.map((s, i) => {
    const mine = logged.filter((a) => a.step_id === s.id);
    const legacy = progress.get(s.id);
    const attempts = Math.max(mine.length, legacy.attempts);
    const best = Math.max(legacy.best, ...mine.map((a) => Math.round(a.score.overall)));
    const mastery = lp?.steps[i] ?? null;
    return { attempts, best, mastery, done: Boolean(mastery?.mastered_at) };
  });
  const done = stepState.filter((st) => st.done).length;
  const pct = lesson.steps.length ? Math.round((done / lesson.steps.length) * 100) : 0;
  const test = lesson.test ? TEST_COPY[lesson.test.kind] : PLAY_COPY;
  const journey = journeyDone(lesson, stepState);
  const seen = tutorialsSeen(lesson.id);
  const played = playRecord(lesson.id);
  /** Only the first unfinished lesson (not mastered yet, or with its review due) gets the large primary button. */
  const nextIndex = stepState.findIndex((st) => !st.done || (st.mastery !== null && isDue(st.mastery, today)));

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
            <span className="ap-num">{done}</span> of <span className="ap-num">{lesson.steps.length}</span> {lesson.steps.length === 1 ? 'lesson' : 'lessons'} mastered
          </span>
          <span className="ap-bar__track" role="presentation">
            <span className="ap-bar__fill ap-bar__fill--ok" style={{ width: `${pct}%` }} />
          </span>
        </div>
      </div>
      <JourneyLine done={journey} />

      {lesson.steps.length === 0 && <p className="note ap-state">This course has no lessons yet.</p>}
      <ol className="ap-syllabus">
        {lesson.steps.map((s, i) => {
          const st = stepState[i];
          const primary = i === nextIndex;
          return (
            <li key={s.id}>
              <Card as="article" className="ap-lesson">
                <div className="ap-lesson__media">
                  <VideoSlot key={String(showProps)} url={tutorialVideoOf(s)?.url ?? null} title={s.title} motion={s.motion} prop={shownProp(s.prop, showProps)} side={stepSide(s)} />
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
                      {st.attempts === 0 ? (
                        'Not started'
                      ) : (
                        <span>
                          Best <span className="ap-num">{st.best}</span> in <span className="ap-num">{st.attempts}</span> {st.attempts === 1 ? 'attempt' : 'attempts'}
                        </span>
                      )}
                      {st.done && st.mastery && (
                        <span className="ap-lesson__mastery">
                          {isDue(st.mastery, today) ? 'Mastered blind. Review due.' : `Mastered blind. Next review ${st.mastery.next_due ? formatDueDay(st.mastery.next_due, today) : 'soon'}.`}
                        </span>
                      )}
                    </span>
                    <span className="ap-lesson__actions">
                      {/* A fresh lesson opens with its tutorial; after that the tutorial stays one quiet link away. */}
                      {primary && st.attempts === 0 && !seen.has(s.id) ? (
                        <>
                          <ButtonLink to={`/apprentice/lessons/${lesson.id}/steps/${i}`} variant="secondary">
                            Start practising
                          </ButtonLink>
                          <ButtonLink to={`/apprentice/lessons/${lesson.id}/steps/${i}/tutorial`} large>
                            Watch the tutorial
                          </ButtonLink>
                        </>
                      ) : (
                        <>
                          <ButtonLink to={`/apprentice/lessons/${lesson.id}/steps/${i}/tutorial`} variant="ghost">
                            Tutorial
                          </ButtonLink>
                          <ButtonLink to={`/apprentice/lessons/${lesson.id}/steps/${i}`} variant={primary ? 'primary' : 'secondary'} large={primary}>
                            {st.done ? 'Review' : st.attempts === 0 ? 'Start practising' : 'Practise again'}
                          </ButtonLink>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
        <li>
          <Card as="article" className="ap-lesson ap-lesson--test">
            <div className="ap-lesson__body ap-lesson__body--wide">
              <h2>{test.title}</h2>
              <p className="ap-lesson__instruction">{test.blurb}</p>
              {lesson.test ? (
                <ul className="ap-meta" aria-label="Game details">
                  <li>{lesson.test.opponent === 'two_player' ? 'Two players, one glove each' : 'Against the bot'}</li>
                  <li>{lesson.test.rounds} rounds</li>
                </ul>
              ) : (
                <ul className="ap-meta" aria-label="Round details">
                  <li>{PLAY_CALLS} calls a round</li>
                  <li>Scored live</li>
                </ul>
              )}
              <div className="ap-lesson__foot">
                <span className="ap-lesson__prog">
                  {played && !lesson.test ? (
                    <span>
                      Best round <span className="ap-num">{played.best}</span> in <span className="ap-num">{played.rounds}</span> {played.rounds === 1 ? 'round' : 'rounds'}
                    </span>
                  ) : done < lesson.steps.length ? (
                    'Best after the lessons, but open to everyone.'
                  ) : (
                    'You have mastered every lesson.'
                  )}
                </span>
                <ButtonLink to={`/apprentice/lessons/${lesson.id}/${lesson.test ? 'test' : 'play'}`} variant={nextIndex < 0 ? 'primary' : 'secondary'} large={nextIndex < 0}>
                  Play
                </ButtonLink>
              </div>
            </div>
          </Card>
        </li>
      </ol>
      <PlanCard lesson={lesson} />
      <div className="ap-course__back">
        <BackLink to={skillPath(lesson.skill)}>Back to {skillName(lesson.skill)}</BackLink>
      </div>
    </>
  );
}
