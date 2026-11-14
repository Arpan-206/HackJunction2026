import type { Lesson, Skill } from '../../../api';
import { CATALOGUE, skillName } from '../../apprentice/skills/catalogue';

/** Where a lesson came from, in plain words for its folio. */
export const SOURCE_LABEL: Record<Lesson['source'], string> = {
  seed: 'From the pattern book',
  scratch: 'Recorded from scratch',
  generated: 'Drafted with the AI Assistant',
};

/** Newest first, then by title so seeded lessons of the same day keep a stable order. */
export function shelfOrder(lessons: Lesson[]): Lesson[] {
  return [...lessons].sort((a, b) => (a.created_at === b.created_at ? a.title.localeCompare(b.title) : a.created_at < b.created_at ? 1 : -1));
}

export const stepsLabel = (n: number): string => `${n} ${n === 1 ? 'step' : 'steps'}`;
export const lessonsLabel = (n: number): string => `${n} ${n === 1 ? 'lesson' : 'lessons'}`;

/**
 * The folio's line under the title: the skill and how many steps. A skill made from scratch is filed as `general` on the
 * wire and its own name is the lesson title, so only the step count is said for it, as for a title that names its skill.
 */
export function folioLine(lesson: Pick<Lesson, 'skill' | 'steps' | 'title'>): string {
  const steps = stepsLabel(lesson.steps.length);
  if (lesson.skill === 'general') return steps;
  const skill = skillName(lesson.skill);
  // "Piano: first fingering" already says Piano.
  return lesson.title.toLowerCase().startsWith(skill.toLowerCase()) ? steps : `${skill}, ${steps}`;
}

function dayOf(iso: string, withTime: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return withTime ? `${day}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : day;
}

function practisedWords(n: number): string {
  return n > 0 ? `practised ${n} ${n === 1 ? 'time' : 'times'}` : '';
}

function joinWhen(when: string, reps: string): string {
  if (when && reps) return `${when}, ${reps}`;
  return when || (reps ? reps[0].toUpperCase() + reps.slice(1) : '');
}

/**
 * "Added 14 Nov", and how often it was practised on this station when it was. `withTime` adds the hour, so two lessons
 * of the same title added the same day can still be told apart.
 */
export function folioWhen(createdAt: string, practised: number, withTime = false): string {
  const day = dayOf(createdAt, withTime);
  return joinWhen(day ? `Added ${day}` : '', practisedWords(practised));
}

/** "Last added 14 Nov, practised 12 times" for a skill card. */
export function skillWhen(lastAdded: string, practised: number): string {
  const day = dayOf(lastAdded, false);
  return joinWhen(day ? `Last added ${day}` : '', practisedWords(practised));
}

/** The lesson ids whose title appears more than once in a list, so their folios show the time they were added. */
export function sharedTitles(lessons: Pick<Lesson, 'id' | 'title'>[]): Set<string> {
  const count = new Map<string, number>();
  const key = (t: string) => t.trim().toLowerCase();
  for (const l of lessons) count.set(key(l.title), (count.get(key(l.title)) ?? 0) + 1);
  return new Set(lessons.filter((l) => (count.get(key(l.title)) ?? 0) > 1).map((l) => l.id));
}

/** A word-safe slug of a skill's own name: "Pottery: the wheel" -> "pottery-the-wheel". */
function slug(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'skill'
  );
}

/** Prefix of the key of a skill an expert made from scratch (wire skill `general`), so it never clashes with a catalogue id. */
export const OWN_PREFIX = 'own-';

/**
 * Which skill a lesson belongs to on the shelf: its catalogue skill id, or, for a skill made from scratch (filed as
 * `general`), its own name, which is the lesson title. Lessons of "Pottery" therefore share one skill card.
 */
export function skillKeyOf(lesson: Pick<Lesson, 'skill' | 'title'>): string {
  return lesson.skill === 'general' ? `${OWN_PREFIX}${slug(lesson.title)}` : lesson.skill;
}

/** One skill on the expert's shelf, with its lessons newest first. */
export interface ShelfSkill {
  key: string;
  /** The wire skill: a catalogue id, or `general` for a skill made from scratch. */
  skill: Skill;
  name: string;
  /** True for one of the catalogue skills (Table tennis, Piano, ...), false for one the expert made. */
  catalogue: boolean;
  lessons: Lesson[];
  steps: number;
  /** ISO time of the newest lesson. */
  lastAdded: string;
  /** Practice reps logged on this station across every lesson of the skill. */
  practised: number;
}

/**
 * The expert's shelf: one card per skill, ordered by the most recently added lesson in it. Practice counts come from the
 * attempts logged on this station, keyed by lesson id.
 */
export function groupBySkill(lessons: Lesson[], attempts: Record<string, unknown[] | undefined> = {}): ShelfSkill[] {
  const groups = new Map<string, Lesson[]>();
  for (const l of lessons) {
    const k = skillKeyOf(l);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const skills = [...groups.entries()].map(([key, list]): ShelfSkill => {
    const ordered = shelfOrder(list);
    const newest = ordered[0];
    const own = newest.skill === 'general';
    return {
      key,
      skill: newest.skill,
      name: own ? newest.title.trim() || 'Untitled skill' : skillName(newest.skill),
      catalogue: !own && CATALOGUE.some((c) => c.id === newest.skill),
      lessons: ordered,
      steps: ordered.reduce((n, l) => n + l.steps.length, 0),
      lastAdded: newest.created_at,
      practised: ordered.reduce((n, l) => n + (attempts[l.id]?.length ?? 0), 0),
    };
  });
  return skills.sort((a, b) => (a.lastAdded === b.lastAdded ? a.name.localeCompare(b.name) : a.lastAdded < b.lastAdded ? 1 : -1));
}

/** The expert's page for one skill. */
export const expertSkillPath = (key: string): string => `/expert/skills/${encodeURIComponent(key)}`;
