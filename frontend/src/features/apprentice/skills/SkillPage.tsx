import { Link, useParams } from 'react-router-dom';
import type { Step } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { ButtonLink } from '../../../components/ui';
import { useAllAttempts, useAllTests } from '../../shared/practiceLog';
import { BackLink } from '../ApHeader';
import { finaleTitle, lessonTitle } from '../course/LessonCourse';
import { isDemo } from '../pipeline/flags';
import { playRecord, tutorialsSeen } from '../pipeline/journey';
import { DEFAULT_CONFIG, DEMO_CONFIG } from '../pipeline/stages';
import { HANDS_LABEL, type SkillProgress, type SkillView } from './catalogue';
import { expertName, skillJourney, type PathLesson, type PathPart } from './journeyMap';
import { DifficultyLine } from './SkillParts';
import { SkillShowcase, WorkshopShowcase } from './SkillShowcase';
import { useSkills } from './useSkills';
import './skills.css';

/** What one lesson's line under its title says: mastered (and whether a review is due), the best so far, or not started. */
function lessonStatus(l: PathLesson): string {
  if (l.mastered) return l.due ? `Mastered, best ${l.best}. Review due today.` : `Mastered, best ${l.best}`;
  if (l.attempts === 0) return 'Not started';
  return `Best ${l.best} in ${l.attempts} ${l.attempts === 1 ? 'attempt' : 'attempts'}`;
}

function Facts({ skill }: { skill: SkillView }) {
  return (
    <dl className="sk-facts">
      <div>
        <dt>Level</dt>
        <dd>
          <DifficultyLine difficulty={skill.difficulty} />
        </dd>
      </div>
      <div>
        <dt>Hands</dt>
        <dd>{HANDS_LABEL[skill.hands]}</dd>
      </div>
      <div>
        <dt>Time to learn</dt>
        <dd>{skill.timeToLearn}</dd>
      </div>
    </dl>
  );
}

function PrimaryActions({ skill, progress }: { skill: SkillView; progress: SkillProgress }) {
  const next = progress.next;
  const tested = skill.courses.find((c) => c.test);
  if (!next) return null;
  const n = next.index + 1;
  const label = next.kind === 'start' ? `Start lesson ${n}` : next.kind === 'continue' ? `Continue lesson ${n}` : `Review lesson ${n}`;
  return (
    <div className="sk-actions">
      <ButtonLink to={`/apprentice/lessons/${next.courseId}/steps/${next.index}`} large>
        {label}
      </ButtonLink>
      {tested && (
        <ButtonLink to={`/apprentice/lessons/${tested.id}/test`} variant="secondary" large>
          Test your skills
        </ButtonLink>
      )}
    </div>
  );
}

/** The ink mark beside a part: a malachite tick when done (gold for Ghost off, which is mastery), a dot now, a ring ahead. */
function PartMark({ state, mastery }: { state: PathPart['state']; mastery: boolean }) {
  return (
    <svg className={`sk-part__mark${mastery ? ' is-gold' : ''}`} viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      {state === 'done' ? (
        <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : state === 'now' ? (
        <circle cx="10" cy="10" r="5.5" fill="currentColor" />
      ) : (
        <circle cx="10" cy="10" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      )}
    </svg>
  );
}

const PART_STATE_TEXT: Record<PathPart['state'], string> = { done: 'done', now: 'up next', next: 'ahead' };

/** One lesson on the timeline: its roundel on the spine, its title (opens it where it left off), its progress and its parts. */
function LessonNode({ step, lesson }: { step: Step; lesson: PathLesson }) {
  const title = lessonTitle(step, lesson.index);
  const tone = lesson.mastered ? ' is-mastered' : lesson.here ? ' is-here' : lesson.attempts > 0 ? ' is-started' : '';
  return (
    <li className={`sk-node${tone}`} aria-current={lesson.here ? 'step' : undefined}>
      <span className="sk-node__mark" aria-hidden="true">
        {lesson.index + 1}
      </span>
      <div className="sk-node__main">
        <h4 className="sk-node__title">
          <Link to={lesson.to} className="sk-node__link">
            {title}
          </Link>
        </h4>
        <p className="sk-node__state">
          {lesson.here && <span className="sk-node__here">You are here. </span>}
          {lessonStatus(lesson)}
        </p>
      </div>
      <ol className="sk-parts" aria-label={`Parts of ${title}`}>
        {lesson.parts.map((p) => (
          <li key={p.key}>
            <Link to={p.to} className={`sk-part is-${p.state}`}>
              <PartMark state={p.state} mastery={p.key === 'blind' && p.state === 'done'} />
              <span>{p.label}</span>
              <span className="ap-sr">, {PART_STATE_TEXT[p.state]}</span>
            </Link>
          </li>
        ))}
      </ol>
    </li>
  );
}

/**
 * The timeline under the hero: every course of the skill as a chapter, each lesson a station on one inked spine, and the
 * course's game or Play round at its end. Every lesson and every part is a link, so a lesson done long ago is one click
 * away; the lesson the Continue button opens is marked "You are here".
 */
function SkillPath({ skill, progress }: { skill: SkillView; progress: SkillProgress }) {
  const attempts = useAllAttempts();
  const tests = useAllTests();
  const cfg = isDemo() ? DEMO_CONFIG : DEFAULT_CONFIG;
  const courses = skillJourney({ courses: skill.courses, progress, attempts, tests, seen: tutorialsSeen, played: playRecord, cfg });
  return (
    <section className="sk-path" aria-labelledby="sk-path-h">
      <div className="sk-path__head">
        <h2 id="sk-path-h">Your path</h2>
        <p className="sk-path__sum">
          <span className="ap-num">{progress.mastered}</span> of <span className="ap-num">{progress.total}</span> {progress.total === 1 ? 'lesson' : 'lessons'} mastered. Open any lesson, or any part of one.
        </p>
      </div>
      {skill.courses.map((course, ci) => {
        const path = courses[ci];
        const unit = course.test ? 'game' : 'round';
        return (
          <section key={course.id} className="sk-chapter" aria-labelledby={`sk-ch-${course.id}`}>
            <div className="sk-chapter__head">
              <h3 id={`sk-ch-${course.id}`}>
                <Link to={path.to} className="sk-chapter__link">
                  {course.title}
                </Link>
              </h3>
              <p className="sk-chapter__by">
                Taught by {expertName(course.master_name)}. <span className="ap-num">{path.mastered}</span> of <span className="ap-num">{path.lessons.length}</span> mastered.
              </p>
            </div>
            <ol className="sk-spine">
              {course.steps.map((s, i) => (
                <LessonNode key={s.id} step={s} lesson={path.lessons[i]} />
              ))}
              <li className={`sk-node sk-node--finale${path.finale.played ? ' is-started' : ''}`}>
                <span className="sk-node__mark" aria-hidden="true" />
                <div className="sk-node__main">
                  <h4 className="sk-node__title">
                    <Link to={path.finale.to} className="sk-node__link">
                      {finaleTitle(course)}
                    </Link>
                  </h4>
                  <p className="sk-node__state">
                    {path.finale.best !== null
                      ? `Best ${path.finale.best} in ${path.finale.played} ${path.finale.played === 1 ? unit : `${unit}s`}`
                      : path.mastered < path.lessons.length
                        ? 'Best after the lessons, but open to everyone.'
                        : 'Every lesson mastered: time to play.'}
                  </p>
                </div>
              </li>
            </ol>
          </section>
        );
      })}
    </section>
  );
}

/**
 * One skill: a large showcase of its first lessons on the left, and on the right what it is, how hard, which hands, how long,
 * the one action that matters next and the lessons it holds. A workshop skill says plainly that it cannot be practised yet.
 */
export function SkillPage() {
  const { skillId = '' } = useParams();
  const { skills, lessons, loading, error, offline, progressOf } = useSkills();
  const skill = skills.find((s) => s.id === skillId);

  if (loading && !lessons) return <p className="note ap-state">Opening the skill...</p>;
  if (!skill) {
    return (
      <div className="ap-state">
        <PageHeader title="Skill not found" />
        <p className="note">{error?.message ?? 'There is no skill with that name.'}</p>
        <ButtonLink to="/apprentice" variant="secondary">
          Back to skills
        </ButtonLink>
      </div>
    );
  }

  const progress = progressOf(skill);
  return (
    <>
      <div className="sk-back">
        <BackLink to="/apprentice">All skills</BackLink>
      </div>
      <PageHeader title={skill.name} />
      {offline && <p className="note ap-banner">Backend offline: showing the built-in demo lessons.</p>}
      <div className={`sk-page${skill.live ? '' : ' sk-page--workshop'}`}>
        <div className="sk-page__show">{skill.live && skill.courses[0] ? <SkillShowcase course={skill.courses[0]} scene={skill.scene} /> : <WorkshopShowcase pose={skill.keyPose} name={skill.name} scene={skill.scene} />}</div>
        <div className="sk-page__info">
          <p className="sk-page__lede">{skill.description}</p>
          {skill.live && <PrimaryActions skill={skill} progress={progress} />}
          {skill.live && skill.id === 'fingerspelling' && (
            <div className="sk-page__extra">
              <ButtonLink to="/apprentice/fingerspelling" variant="secondary">
                Spell a word
              </ButtonLink>
              <ButtonLink to="/apprentice/fingerspelling?tab=chart" variant="secondary">
                Open the letter chart
              </ButtonLink>
            </div>
          )}
          <Facts skill={skill} />
          {!skill.live && (
            <>
              <p className="sk-page__notyet">
                Not teachable yet: no expert has recorded it with the gloves.
              </p>
              {skill.wouldTeach && skill.wouldTeach.length > 0 && (
                <section className="sk-learn" aria-labelledby="sk-learn-h">
                  <h2 id="sk-learn-h">What its lessons would cover</h2>
                  <ul className="sk-lessons">
                    {skill.wouldTeach.map((t) => (
                      <li key={t} className="sk-lessons__item">
                        <span className="sk-lessons__title">{t}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
      {skill.live && skill.courses.length > 0 && <SkillPath skill={skill} progress={progress} />}
    </>
  );
}
