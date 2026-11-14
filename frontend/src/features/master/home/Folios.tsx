import { Link } from 'react-router-dom';
import type { Lesson } from '../../../api';
import { CATALOGUE } from '../../apprentice/skills/catalogue';
import { SkillStill } from '../../apprentice/skills/SkillParts';
import { FolioPicture } from './FolioPicture';
import { expertSkillPath, folioWhen, lessonsLabel, type ShelfSkill, skillWhen, SOURCE_LABEL, stepsLabel } from './shelf';

/**
 * A skill's picture: for a catalogue skill the same still its apprentice dashboard card shows (the key pose in its scene,
 * or the shadow puppets wall); for a skill the expert made, the first move of its newest lesson.
 */
function SkillPicture({ s }: { s: ShelfSkill }) {
  const entry = CATALOGUE.find((c) => c.id === s.skill);
  if (!s.catalogue || !entry) return <FolioPicture lesson={s.lessons[0]} />;
  return (
    <div className="folio__pic">
      {entry.still ? (
        <img className="folio__still" src={entry.still.src} alt={entry.still.alt} loading="lazy" />
      ) : (
        <SkillStill className="folio__still" pose={entry.keyPose} scene={entry.scene} label={`${entry.name}: the key pose`} />
      )}
    </div>
  );
}

/** One skill on the studio shelf: its picture, its name, how many lessons and steps, when a lesson was last added. */
export function SkillCard({ s }: { s: ShelfSkill }) {
  const when = skillWhen(s.lastAdded, s.practised);
  return (
    <Link to={expertSkillPath(s.key)} className="folio">
      <SkillPicture s={s} />
      <span className="folio__text">
        <span className="folio__title">{s.name}</span>
        <span className="folio__line">
          {lessonsLabel(s.lessons.length)}, {stepsLabel(s.steps)}
        </span>
        {when && <span className="folio__when">{when}</span>}
      </span>
    </Link>
  );
}

/**
 * One lesson of a skill: the first move's picture, the title, the steps, where it came from and when it was added.
 * `withTime` adds the hour to the date, for a lesson that shares its title with another.
 */
export function LessonFolio({ lesson, practised, withTime }: { lesson: Lesson; practised: number; withTime: boolean }) {
  const when = folioWhen(lesson.created_at, practised, withTime);
  return (
    <Link to={`/expert/lessons/${lesson.id}`} className="folio">
      <FolioPicture lesson={lesson} />
      <span className="folio__text">
        <span className="folio__title">{lesson.title}</span>
        <span className="folio__line">{stepsLabel(lesson.steps.length)}</span>
        <span className="folio__from">{SOURCE_LABEL[lesson.source]}</span>
        {when && <span className="folio__when">{when}</span>}
      </span>
    </Link>
  );
}
