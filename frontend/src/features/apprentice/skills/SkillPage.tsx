import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../../components/PageHeader';
import { ButtonLink } from '../../../components/ui';
import { BackLink } from '../ApHeader';
import { lessonTitle } from '../course/LessonCourse';
import { HANDS_LABEL, type LessonState, type SkillProgress, type SkillView } from './catalogue';
import { DifficultyLine } from './SkillParts';
import { SkillShowcase, WorkshopShowcase } from './SkillShowcase';
import { useSkills } from './useSkills';
import './skills.css';

function lessonStatus(st: LessonState | undefined): { text: string; mastered: boolean } {
  if (!st || st.attempts === 0) return { text: 'Not started', mastered: false };
  if (st.mastered) return { text: st.due ? 'Mastered, review due' : 'Mastered', mastered: true };
  return { text: `Best ${st.best} in ${st.attempts} ${st.attempts === 1 ? 'attempt' : 'attempts'}`, mastered: false };
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

function WhatYouLearn({ skill, progress }: { skill: SkillView; progress: SkillProgress }) {
  return (
    <section className="sk-learn" aria-labelledby="sk-learn-h">
      <h2 id="sk-learn-h">What you will learn</h2>
      {progress.started && (
        <p className="sk-learn__sum">
          {progress.mastered} of {progress.total} {progress.total === 1 ? 'lesson' : 'lessons'} mastered
        </p>
      )}
      {skill.courses.map((course, ci) => (
        <div key={course.id} className="sk-course">
          <div className="sk-course__head">
            <h3>{course.title}</h3>
            <span className="sk-course__by">
              Taught by {course.master_name}.{' '}
              <Link to={`/apprentice/lessons/${course.id}`} className="sk-link">
                Open the course
              </Link>
            </span>
          </div>
          <ol className="sk-lessons">
            {course.steps.map((s, i) => {
              const st = progress.lessons[ci]?.[i];
              const status = lessonStatus(st);
              return (
                <li key={s.id} className="sk-lessons__item">
                  <span className="sk-lessons__title">{lessonTitle(s, i)}</span>
                  <span className={`sk-lessons__state${status.mastered ? ' is-mastered' : ''}`}>{status.text}</span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
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
          {skill.live ? (
            <WhatYouLearn skill={skill} progress={progress} />
          ) : (
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
    </>
  );
}
