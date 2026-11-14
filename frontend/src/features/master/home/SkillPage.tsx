import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLessons } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { Button, ButtonLink } from '../../../components/ui';
import { useAllAttempts } from '../../shared/practiceLog';
import { RevealFile } from '../files/RevealFile';
import { SaveToFile } from '../files/SaveToFile';
import { isDev } from '../../apprentice/pipeline/flags';
import { LessonFolio } from './Folios';
import { groupBySkill, lessonsLabel, sharedTitles, type ShelfSkill, skillWhen, stepsLabel } from './shelf';
import './home.css';

/** Where "Record a new lesson" starts: Start from scratch, carrying this skill so the lesson is filed under it. */
function recordHref(s: ShelfSkill): string {
  const q = s.skill === 'general' ? new URLSearchParams({ skill: 'general', name: s.name }) : new URLSearchParams({ skill: s.skill });
  return `/expert/scratch?${q.toString()}`;
}

function BackToStudio() {
  return (
    <Link className="studio__back" to="/expert">
      <span aria-hidden="true" className="studio__back-arrow" />
      Back to the studio
    </Link>
  );
}

/**
 * /expert/skills/:skillKey: one skill's lessons as folios, newest first, each opening its lesson editor. Lessons that
 * share a title show the hour they were added beside where they came from, so they can be told apart.
 */
export function SkillPage() {
  const { skillKey } = useParams();
  const { data: lessons, error, loading, reload } = useLessons();
  const attempts = useAllAttempts();
  const skill = useMemo(() => (lessons ? groupBySkill(lessons, attempts).find((s) => s.key === skillKey) : undefined), [lessons, attempts, skillKey]);
  const twins = useMemo(() => sharedTitles(skill?.lessons ?? []), [skill]);

  if (!skill) {
    return (
      <div className="studio">
        <BackToStudio />
        <PageHeader title="Skill" />
        {loading && <p className="note">Consulting the ledger...</p>}
        {error && (
          <div className="mst-err" role="alert">
            <p className="note">The lesson ledger could not be opened. Check that the backend is running, then try again.</p>
            <Button variant="secondary" onClick={reload}>
              Try again
            </Button>
          </div>
        )}
        {lessons && <p className="note">No lessons are filed under this skill.</p>}
      </div>
    );
  }

  const dev = isDev();
  const when = skillWhen(skill.lastAdded, skill.practised);
  return (
    <div className="studio">
      <BackToStudio />
      <PageHeader title={skill.name} context={`${lessonsLabel(skill.lessons.length)}, ${stepsLabel(skill.steps)}.${when ? ` ${when}.` : ''}`} />
      <div className="skillpage__actions">
        <ButtonLink to={recordHref(skill)}>Record a new lesson for this skill</ButtonLink>
        <SaveToFile lessonIds={skill.lessons.map((l) => l.id)} name={skill.name} />
      </div>
      <section className="shelf" aria-label={`Lessons of ${skill.name}`}>
        <ul className="shelf__list">
          {skill.lessons.map((l) => (
            <li key={l.id} className={dev ? 'skillpage__item--dev' : undefined}>
              <LessonFolio lesson={l} practised={attempts[l.id]?.length ?? 0} withTime={twins.has(l.id)} />
              <RevealFile kind="lesson" id={l.id} what={l.title} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
