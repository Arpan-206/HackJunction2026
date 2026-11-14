/**
 * The skill catalogue behind the learner dashboard: what each skill is, how hard it is, which hands it needs, roughly how long
 * it takes and the key pose its card shows. Skills with lessons from the API are live; the rest are "in the workshop", known
 * skills no expert has recorded yet. A lesson for a skill id this module does not know still shows
 * up as a live skill with sensible defaults. Everything here is pure, so the merge and the search are unit tested.
 */
import type { Lesson, MotionSpec, Step } from '../../../api/types';
import type { LoggedAttempt } from '../../shared/practiceLog';
import { deriveStep, isDue } from '../pipeline/progress';
import { DEFAULT_CONFIG, type PipelineConfig } from '../pipeline/stages';

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type HandsNeeded = 'one' | 'two';
/** The chalk set a card draws around the key pose, so the skill reads at a glance with props off. */
export type SkillScene = 'racket' | 'keys' | 'letter';

export const DIFFICULTIES: Difficulty[] = ['beginner', 'intermediate', 'advanced'];
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
/** Filled marks on the three-mark scale. */
export const DIFFICULTY_MARKS: Record<Difficulty, 1 | 2 | 3> = { beginner: 1, intermediate: 2, advanced: 3 };
export const HANDS_LABEL: Record<HandsNeeded, string> = { one: 'One hand', two: 'Two hands' };

/** The pose a skill's card shows: a motion sampled at one moment. */
export interface KeyPose {
  motion: MotionSpec;
  /** Seconds into the motion; 0 for a held shape. */
  t: number;
}

export interface CatalogueEntry {
  id: string;
  name: string;
  /** The live hand follows its position in space from the phone's depth (three/handPosition.ts). Default false. */
  handPosition?: boolean;
  /** One or two plain sentences for the card search and the top of the skill page. */
  description: string;
  difficulty: Difficulty;
  /** Extra words the search should find the skill by. */
  keywords: string[];
  hands: HandsNeeded;
  /** A rough, honest time to learn, in words. */
  timeToLearn: string;
  keyPose: KeyPose;
  /** A picture for the card instead of the key pose on a chalk hand, for a skill whose look is not the hand itself. */
  still?: { src: string; alt: string };
  /** What the card sketches around the hand: the racket and ball, the keys on the bench, or a held letter. Default letter. */
  scene?: SkillScene;
  /** For a skill in the workshop: what its lessons would cover once an expert records them. */
  wouldTeach?: string[];
}

const hold = (thumb: number, index: number, middle: number, ring: number, little: number): KeyPose => ({
  motion: { preset: 'hold_pose', pose: { thumb, index, middle, ring, little } },
  t: 0,
});

/** The four demo skills, in dashboard order. A lesson for any other skill id still shows up after them with defaults. */
export const CATALOGUE: CatalogueEntry[] = [
  {
    id: 'table_tennis',
    name: 'Table tennis',
    description: 'A steady shakehand grip, a clean forehand swing and the snap of the wrist at contact.',
    difficulty: 'intermediate',
    keywords: ['grip', 'racket', 'sport', 'swing', 'forehand', 'ping pong', 'wrist', 'ball'],
    hands: 'one',
    timeToLearn: 'About a week at 15 minutes a day',
    // The shakehand grip held still: the racket's face reads clearly before the swing turns it edge on.
    keyPose: hold(0.62, 0.8, 0.84, 0.86, 0.88),
    scene: 'racket',
    handPosition: true,
  },
  {
    id: 'piano',
    name: 'Piano',
    description: 'Set a curved hand on the keys and play a five-finger scale up and back down, evenly.',
    difficulty: 'beginner',
    keywords: ['music', 'keys', 'keyboard', 'fingering', 'scale', 'instrument', 'notes'],
    hands: 'one',
    timeToLearn: 'A few days at 10 minutes a day',
    keyPose: { motion: { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5], beat_ms: 620 }, t: 1.55 },
    scene: 'keys',
  },
  // Finnish fingerspelling on the dashboard (curls are estimates until an expert records them). The pack-aware
  // fingerspelling drill (ASL alphabet, Finnish slots shown as not recorded yet) lives at /apprentice/fingerspelling and
  // stays off the dashboard through HIDDEN_SKILLS below, as Szymon's 17:22 narrowing intended. Arpan's rule for
  // Finnish letters is 'never a placeholder pose': which of the two the demo keeps is a human decision, see STATUS.md.
  {
    id: 'finnish_fingerspelling',
    name: 'Finnish fingerspelling',
    description: 'Spell words letter by letter with the one-handed Finnish manual alphabet, A to Z plus Å, Ä and Ö, with every finger checked.',
    difficulty: 'intermediate',
    keywords: ['sign', 'sign language', 'finnish', 'suomi', 'viittomakieli', 'letters', 'alphabet', 'deaf', 'spelling', 'words', 'names', 'accessibility'],
    hands: 'one',
    timeToLearn: 'Two weeks at 10 minutes a day',
    // The letter Y: thumb and little finger out, the clearest shape of the alphabet from any side.
    keyPose: hold(0, 1, 1, 1, 0),
    scene: 'letter',
    wouldTeach: ['Clear letters first: A, I, L, V and Y', 'Spelling VIILI and LAVA at an even pace', 'The rest of the alphabet, A to Z plus Å, Ä and Ö'],
  },
  {
    id: 'shadow_puppets',
    name: 'Shadow puppets',
    description: "The oil lamp throws your hands onto the plaster wall: match the expert's rabbit, dog, swan, bird and snail by candlelight.",
    difficulty: 'beginner',
    keywords: ['play', 'shapes', 'animals', 'wall', 'candle', 'candlelight', 'theatre', 'children', 'story', 'rabbit', 'dog', 'swan', 'bird', 'snail'],
    hands: 'two',
    timeToLearn: 'An evening',
    keyPose: hold(0.7, 0, 0, 0.9, 0.9),
    // The talking dog with its jaw open, drawn from the lesson's own theatre; hovering the card plays it.
    still: { src: '/stills/shadow-puppets.jpg', alt: "The expert's talking dog, a hand's shadow on the plaster wall by lamplight" },
  },
];

/** A skill as the dashboard shows it: the catalogue entry merged with the lessons (courses) the API serves for it. */
export interface SkillView extends CatalogueEntry {
  /** Live when at least one course with lessons exists for it; otherwise it is still in the workshop. */
  live: boolean;
  /** Its courses, newest per title, the seed course first and then oldest first. */
  courses: Lesson[];
  /** Lessons (steps) across every course. */
  lessonCount: number;
}

/** One card per course title: when an expert has recorded the same course twice, the newest wins. */
export function newestPerTitle(lessons: Lesson[]): Lesson[] {
  const key = (l: Lesson) => l.title.trim().toLowerCase();
  const best = new Map<string, Lesson>();
  for (const l of lessons) {
    const seen = best.get(key(l));
    if (!seen || l.created_at > seen.created_at) best.set(key(l), l);
  }
  return lessons.filter((l) => best.get(key(l)) === l);
}

/** "shadow_puppets" -> "Shadow puppets": a readable name for a skill id nobody has described yet. */
export function skillNameFromId(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Untitled skill';
}

/** The display name of a skill id, from the catalogue when it is known. */
export function skillName(id: string): string {
  return CATALOGUE.find((c) => c.id === id)?.name ?? skillNameFromId(id);
}

/** Whether a skill's live hand follows its position in space (the phone's depth): table tennis yes, the rest no. */
export function skillUsesHandPosition(id: string): boolean {
  return CATALOGUE.find((c) => c.id === id)?.handPosition ?? false;
}

/** The dashboard path of a skill page. */
export const skillPath = (id: string): string => `/apprentice/skills/${encodeURIComponent(id)}`;

function handsOf(courses: Lesson[], fallback: HandsNeeded): HandsNeeded {
  if (courses.some((c) => c.steps.some((s) => s.hands === 'both'))) return 'two';
  return fallback;
}

function courseOrder(a: Lesson, b: Lesson): number {
  if ((a.source === 'seed') !== (b.source === 'seed')) return a.source === 'seed' ? -1 : 1;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

/** Catalogue values for a skill id that only exists because an expert created a lesson for it. */
function defaultsFor(id: string, courses: Lesson[]): CatalogueEntry {
  const first = courses[0];
  const step = first?.steps[0];
  const lessons = courses.reduce((n, c) => n + c.steps.length, 0);
  return {
    id,
    name: skillNameFromId(id),
    description: first?.summary || 'A skill recorded by an expert with the gloves.',
    difficulty: 'beginner',
    keywords: [],
    hands: 'one',
    timeToLearn: `About ${Math.max(1, lessons)} ${lessons === 1 ? 'day' : 'days'} of practice`,
    keyPose: { motion: step?.motion ?? { preset: 'idle' }, t: keyPoseTime(step?.motion ?? null) },
  };
}

/** The moment of a motion that best shows it: contact for a swing, the first press for a sequence, any time for a hold. */
export function keyPoseTime(spec: MotionSpec | null): number {
  if (!spec) return 0;
  if (spec.preset === 'grip_and_swing') return (spec.beat_ms / 1000) * 0.615;
  if (spec.preset === 'finger_sequence') return (spec.beat_ms / 1000) * 0.5;
  return 0;
}

/**
 * Merges the catalogue with the lessons from the API, grouping lessons by their skill. Known skills keep catalogue order; a
 * skill id the catalogue lacks becomes a live skill with defaults. Live skills come first, then the workshop.
 */
/** Skills with seed lessons that stay off the dashboard: the American alphabet drill is reached at /apprentice/fingerspelling (the catalogue shows the Finnish skill). */
const HIDDEN_SKILLS: ReadonlySet<string> = new Set(['fingerspelling']);

export function buildSkills(lessons: Lesson[], catalogue: CatalogueEntry[] = CATALOGUE): SkillView[] {
  const bySkill = new Map<string, Lesson[]>();
  for (const l of newestPerTitle(lessons)) {
    if (!l.steps.length || HIDDEN_SKILLS.has(String(l.skill))) continue;
    const id = String(l.skill);
    bySkill.set(id, [...(bySkill.get(id) ?? []), l]);
  }
  const view = (entry: CatalogueEntry, courses: Lesson[]): SkillView => {
    const sorted = [...courses].sort(courseOrder);
    return {
      ...entry,
      hands: handsOf(sorted, entry.hands),
      live: sorted.length > 0,
      courses: sorted,
      lessonCount: sorted.reduce((n, c) => n + c.steps.length, 0),
    };
  };
  const known = new Set(catalogue.map((c) => c.id));
  const listed = catalogue.map((entry) => view(entry, bySkill.get(entry.id) ?? []));
  const extra = [...bySkill.keys()]
    .filter((id) => !known.has(id))
    .sort()
    .map((id) => {
      const courses = [...(bySkill.get(id) ?? [])].sort(courseOrder);
      return view(defaultsFor(id, courses), courses);
    });
  const all = [...listed, ...extra];
  return [...all.filter((s) => s.live), ...all.filter((s) => !s.live)];
}

/** Motions that move (worth a hover preview), as opposed to a held shape or a resting hand. */
const MOVING_PRESETS: ReadonlySet<string> = new Set(['finger_sequence', 'grip_and_swing', 'pinch', 'keyframes']);

/**
 * The lesson a skill card plays while hovered: the first lesson, across its courses, whose motion moves (a swing, a scale,
 * a spelled word, the talking dog), else the first lesson. It is read from the lesson data, so once an expert records that
 * lesson the preview plays the recording instead of the guide motion.
 */
export function previewStep(skill: Pick<SkillView, 'courses'>): Step | null {
  const steps = skill.courses.flatMap((c) => c.steps);
  return steps.find((s) => s.motion && MOVING_PRESETS.has(s.motion.preset)) ?? steps[0] ?? null;
}

/* ---------- search ---------- */

export interface SkillFilter {
  query: string;
  difficulty: Difficulty | null;
  hands: HandsNeeded | null;
}

export const NO_FILTER: SkillFilter = { query: '', difficulty: null, hands: null };

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Everything a skill can be found by: name, description, keywords, and the titles of its courses and lessons. */
export function searchText(skill: SkillView): string {
  const lessons = skill.courses.flatMap((c) => [c.title, ...c.steps.map((s) => s.title)]);
  return fold([skill.name, skill.description, ...skill.keywords, ...lessons].join(' '));
}

/** True when every word of the query appears somewhere in the skill's text (so "sign lang" finds Finnish fingerspelling). */
export function matchesQuery(skill: SkillView, query: string): boolean {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const text = searchText(skill);
  return words.every((w) => text.includes(w));
}

/** The skills that pass the search box and the difficulty and hands toggles, in their original order. */
export function filterSkills(skills: SkillView[], filter: SkillFilter): SkillView[] {
  return skills.filter(
    (s) => matchesQuery(s, filter.query) && (!filter.difficulty || s.difficulty === filter.difficulty) && (!filter.hands || s.hands === filter.hands),
  );
}

/* ---------- progress ---------- */

export interface LessonState {
  courseId: string;
  index: number;
  attempts: number;
  best: number;
  mastered: boolean;
  /** Mastered, and its review falls due today or earlier. */
  due: boolean;
}

export interface SkillProgress {
  /** Per course, per lesson, in course order. */
  lessons: LessonState[][];
  total: number;
  mastered: number;
  started: boolean;
  /** Where the one primary action goes; null for a skill with no lessons. */
  next: { courseId: string; index: number; kind: 'start' | 'continue' | 'review' } | null;
}

/**
 * Progress of a skill from the practice log: lessons mastered blind across its courses, and where to go next. The next
 * lesson is the first one not mastered yet or with a review due; once all are mastered and none is due, the first lesson.
 */
export function skillProgress(courses: Lesson[], attempts: Record<string, LoggedAttempt[]>, today: string, cfg: PipelineConfig = DEFAULT_CONFIG): SkillProgress {
  const lessons = courses.map((c) => {
    const log = attempts[c.id] ?? [];
    return c.steps.map((s, index): LessonState => {
      const mine = log.filter((a) => a.step_id === s.id);
      const m = deriveStep(s.id, log, cfg);
      const mastered = Boolean(m.mastered_at);
      return {
        courseId: c.id,
        index,
        attempts: mine.length,
        best: mine.reduce((b, a) => Math.max(b, Math.round(a.score.overall)), 0),
        mastered,
        due: mastered && isDue(m, today),
      };
    });
  });
  const flat = lessons.flat();
  const started = flat.some((l) => l.attempts > 0);
  const open = flat.find((l) => !l.mastered || l.due);
  const first = flat[0];
  const next = open
    ? { courseId: open.courseId, index: open.index, kind: (open.mastered ? 'review' : started ? 'continue' : 'start') as 'start' | 'continue' | 'review' }
    : first
      ? { courseId: first.courseId, index: first.index, kind: 'review' as const }
      : null;
  return { lessons, total: flat.length, mastered: flat.filter((l) => l.mastered).length, started, next };
}

/** The progress bar under a skill card: the fraction of lessons mastered, its label, and whether the skill is complete. */
export interface ProgressBar {
  /** 0 to 1. */
  fraction: number;
  /** Whole percent, for aria-valuenow. */
  percent: number;
  /** "2 of 3 lessons mastered"; just "3 lessons" before the first rep. */
  label: string;
  /** Every lesson mastered: the only state drawn in gold. */
  complete: boolean;
}

export function progressBar(p: Pick<SkillProgress, 'mastered' | 'total' | 'started'>): ProgressBar {
  const total = Math.max(0, p.total);
  const mastered = Math.min(Math.max(0, p.mastered), total);
  const fraction = total > 0 ? mastered / total : 0;
  const noun = total === 1 ? 'lesson' : 'lessons';
  const label = p.started || mastered > 0 ? `${mastered} of ${total} ${noun} mastered` : `${total} ${noun}`;
  return { fraction, percent: Math.round(fraction * 100), label, complete: total > 0 && mastered === total };
}

/* ---------- why a card matched ---------- */

export interface MatchReason {
  /** Text before the matched word, the word as written, and the text after it: a short phrase to show under the card. */
  before: string;
  match: string;
  after: string;
}

/** Up to `n` words either side of the match, so a long description shrinks to a readable phrase. */
function around(text: string, start: number, end: number, n: number): MatchReason {
  const left = text.slice(0, start).split(/\s+/);
  const right = text.slice(end).split(/\s+/);
  const before = left.slice(-n - 1).join(' ');
  const after = right.slice(0, n + 1).join(' ').replace(/[.,;:]+$/, '');
  return { before: (left.length > n + 1 ? '...' : '') + before, match: text.slice(start, end), after: after + (right.length > n + 1 ? '...' : '') };
}

/**
 * Why a skill matched the search, as a short phrase with the matched word marked: the lesson title, bit of the description or
 * keyword that holds the first query word. Null for an empty query or when the name itself matched (the name says it).
 */
export function matchReason(skill: SkillView, query: string): MatchReason | null {
  const word = fold(query).split(' ').filter(Boolean)[0];
  if (!word || fold(skill.name).includes(word)) return null;
  // Lesson titles first: course titles often repeat the skill name, so they say less about why it matched.
  const steps = skill.courses.flatMap((c) => c.steps.map((s) => s.title.replace(/^lesson\s*\d+\s*:\s*/i, '')));
  const lessons = [...steps, ...skill.courses.map((c) => c.title)];
  const sources: [string, number][] = [...lessons.map((l): [string, number] => [l, 3]), [skill.description, 2], ...skill.keywords.map((k): [string, number] => [k, 3])];
  for (const [text, n] of sources) {
    const at = text.toLowerCase().indexOf(word);
    if (at >= 0) {
      // Grow the match to the whole word, so "gri" shows "grip" in bold.
      let start = at;
      let end = at + word.length;
      while (start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1])) start--;
      while (end < text.length && /[\p{L}\p{N}]/u.test(text[end])) end++;
      return around(text, start, end, n);
    }
  }
  return null;
}
