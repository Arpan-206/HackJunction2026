import { useParams } from 'react-router-dom';
import { PageHeader } from '../../../components/PageHeader';
import { ButtonLink } from '../../../components/ui';
import { BackLink } from '../ApHeader';
import { HANDS_LABEL, type SkillView } from './catalogue';
import { DifficultyLine } from './SkillParts';
import { SkillShowcase, WorkshopShowcase } from './SkillShowcase';
import { SkillTrail } from './SkillTrail';
import { FingerspellingPacks } from '../../fingerspelling/PackList';
import { useSkills } from './useSkills';
import './skills.css';

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

/**
 * One skill: a large showcase of its first lessons on the left, and on the right what it is, how hard, which hands, how long,
 * and its path: every lesson as a node on one line, the current one chosen, any earlier one a click away. A workshop skill says plainly that it cannot be practised yet.
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
          {skill.live && skill.courses.length > 0 && <SkillTrail skill={skill} progress={progress} />}
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
          {skill.live && skill.id === 'fingerspelling' && <FingerspellingPacks />}
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
    </>
  );
}
