import type { CoachPlanRequest, CoachPlanResponse, Finger, Lesson, MotionFromTextResponse, MotionSpec, MoveKind, Skill, Step } from '../api/types';
import { FINGER_NAMES } from './synth';
import { MOVES, SEED_LESSONS } from './seed';
import { newId } from './ids';

/**
 * Deterministic stand-ins for the LLM routes, ported from backend/app/services/llm/fake.py. Nothing here calls a
 * network; the answer depends only on the request text.
 */

export const MOCK_PROVIDER = 'mock';
const VIDEO_FAKE_NOTE = 'Video analysis needs the Gemini provider; this is a generic template based on your text and the file name.';
const GENERAL_MOVES = ['general_pinch', 'general_power_grip', 'general_point'];
const SEED_BY_SKILL: Partial<Record<Skill, string>> = { table_tennis: 'seed-table-tennis', piano: 'seed-piano' };
const KEYWORDS: [Skill, RegExp][] = [
  ['piano', /piano|keyboard|keys|scale|chord|melody/i],
  ['table_tennis', /table tennis|ping|pong|racket|paddle|forehand|backhand|shakehand|penhold/i],
];

export type LessonDraftBody = Omit<Lesson, 'id' | 'created_at'>;

/** Picks a skill from an explicit hint or by keywords in the request. */
export function detectSkill(text: string, hint?: Skill | null): Skill {
  if (hint) return hint;
  for (const [skill, pattern] of KEYWORDS) if (pattern.test(text)) return skill;
  return 'general';
}

/** Builds the deterministic template lesson for a request. */
export function templateLesson(text: string, hint?: Skill | null): LessonDraftBody {
  const skill = detectSkill(text, hint);
  const seedId = SEED_BY_SKILL[skill];
  if (seedId) {
    const seed = JSON.parse(JSON.stringify(SEED_LESSONS.find((l) => l.id === seedId))) as Lesson;
    const draft: Partial<Lesson> = seed;
    delete draft.id;
    delete draft.created_at;
    const base = draft as LessonDraftBody;
    return { ...base, source: 'generated', steps: base.steps.map((s) => ({ ...s, id: newId() })) };
  }
  const steps: Step[] = GENERAL_MOVES.map((id, i) => {
    const move = MOVES.find((m) => m.id === id) as MoveKind;
    return {
      id: newId(),
      title: `Lesson ${i + 1}: ${move.name}`,
      instruction: move.description,
      move_id: move.id,
      hands: move.hands,
      prop: move.prop,
      motion: move.default_motion,
      reference_recording_id: null,
      repetitions: move.default_repetitions,
      tolerance: { angle_deg: 18, timing_ms: 250 },
      video_url: null,
    };
  });
  const topic = text.split(/\s+/).filter(Boolean).join(' ').slice(0, 48) || 'hand skill';
  return {
    title: `Hand skill: ${topic}`,
    skill: 'general',
    summary: 'A short general hand-control warm-up.',
    master_name: 'Expert',
    source: 'generated',
    steps,
    test: null,
  };
}

/** The same template with the video note prefixed to its summary. */
export function templateLessonFromVideo(text: string, filename: string, hint?: Skill | null): LessonDraftBody {
  const draft = templateLesson(`${text} ${filename}`, hint);
  return { ...draft, summary: `${VIDEO_FAKE_NOTE} ${draft.summary}`.trim() };
}

const MOTION_RULES: [RegExp, string][] = [
  [/pinch/i, 'pinch'],
  [/grip|forehand|backhand|penhold|shakehand|swing/i, 'grip_and_swing'],
  [/scale|sequence|piano/i, 'finger_sequence'],
  [/fist|hold/i, 'hold_pose'],
];

/** Picks a motion preset from keywords; 'slow' doubles the beat length within bounds. */
export function templateMotion(text: string): Pick<MotionFromTextResponse, 'motion' | 'explanation'> {
  const preset = MOTION_RULES.find(([re]) => re.test(text))?.[1] ?? 'idle';
  const lowered = text.toLowerCase();
  let motion: MotionSpec;
  if (preset === 'pinch') motion = { preset: 'pinch', fingers: [lowered.includes('middle') ? 3 : 2], beat_ms: 800 };
  else if (preset === 'grip_and_swing')
    motion = { preset: 'grip_and_swing', grip: lowered.includes('penhold') ? 'penhold' : 'shakehand', swing: lowered.includes('backhand') ? 'backhand' : 'forehand', beat_ms: 1500 };
  else if (preset === 'finger_sequence') motion = { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5], beat_ms: 620 };
  else if (preset === 'hold_pose') motion = { preset: 'hold_pose', pose: { thumb: 1, index: 1, middle: 1, ring: 1, little: 1 } };
  else motion = { preset: 'idle' };
  if ('beat_ms' in motion && /\bslow(?:er|ly)?\b/i.test(text)) motion = { ...motion, beat_ms: Math.min(motion.beat_ms * 2, 4000) };
  return { motion, explanation: `Chose the ${preset.replace(/_/g, ' ')} preset for your request.` };
}

/** Derives drills from the weakest finger of the weakest steps, deterministically. */
export function templatePlan(req: CoachPlanRequest): Omit<CoachPlanResponse, 'provider'> {
  const titles = new Map(req.steps.map((s) => [s.step_id, s.title]));
  const byStep = new Map<string, Record<Finger, number>[]>();
  const overall = new Map<string, number[]>();
  for (const a of req.attempts) {
    byStep.set(a.step_id, [...(byStep.get(a.step_id) ?? []), a.score.per_finger]);
    overall.set(a.step_id, [...(overall.get(a.step_id) ?? []), a.score.overall]);
  }
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ranked = [...byStep.keys()].sort(
    (a, b) => mean(overall.get(a) as number[]) - mean(overall.get(b) as number[]) || (a < b ? -1 : a > b ? 1 : 0),
  );
  const drills: CoachPlanResponse['drills'] = [];
  const weak: string[] = [];
  for (const stepId of ranked.slice(0, 4)) {
    const rows = byStep.get(stepId) as Record<Finger, number>[];
    const means = FINGER_NAMES.map((f) => mean(rows.map((r) => r[f])));
    const finger = FINGER_NAMES[means.indexOf(Math.min(...means))];
    const title = titles.get(stepId) ?? stepId;
    drills.push({ step_id: stepId, focus_finger: finger, exercise: `Repeat '${title}' slowly five times, keeping your ${finger} finger relaxed and in line with the guide hand.` });
    weak.push(`${finger} in '${title}'`);
  }
  if (!drills.length) {
    const first = req.steps[0];
    return {
      summary: `You have not scored an attempt in ${req.lesson_title} yet. Start with one slow pass to set a baseline.`,
      drills: [{ step_id: first?.step_id ?? '', focus_finger: null, exercise: `Run through '${first?.title ?? req.lesson_title}' once, slowly, to set a baseline.` }],
      master_note: 'No attempts recorded yet, so there is nothing to report.',
    };
  }
  return {
    summary: `Good effort on ${req.lesson_title}. Your biggest gain is in the ${weak[0]}. Slow down and practise the drills below.`,
    drills,
    master_note: `This learner struggles most with: ${weak.join('; ')}.`,
  };
}
