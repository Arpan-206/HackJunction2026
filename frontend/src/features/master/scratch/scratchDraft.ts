import { FINGERS, type Finger, type Hands, type LessonDraft, type Skill, type Step, type TakesModel } from '../../../api';
import { skillName } from '../../apprentice/skills/catalogue';
import { newStepId, type MoveChoice } from '../lib';

/**
 * The three screens of "Start from scratch", in order. A new skill has no catalogue to pick from, so the flow opens
 * straight on Record; the skill and its moves are named at the end, on Publish.
 */
export const SCREENS = ['record', 'replay', 'publish'] as const;
export type Screen = (typeof SCREENS)[number];

export const SCREEN_LABEL: Record<Screen, string> = { record: 'Record', replay: 'Replay', publish: 'Publish' };

/** Takes the model needs before it can pick a reference and flag an outlier. */
export const TAKES_TARGET = 3;
/** Most takes the model accepts (POST /api/recordings/model). */
export const TAKES_MAX = 5;

/** What the Publish screen offers until the expert types a name of their own. */
export const DEFAULT_SKILL_NAME = 'New skill';
export const defaultMoveName = (n: number): string => `Move ${n}`;

/** What the apprentice reads on a step recorded from scratch, unless the expert writes a line of their own. */
export const FREE_INSTRUCTION = "Follow the expert's hand, finger by finger.";

/** A move whose takes are recorded and modelled, waiting to be published as one lesson step. */
export interface PlannedMove {
  choice: MoveChoice;
  model: TakesModel;
}

/** Everything the scratch flow needs to pick up where it was after a reload (sessionStorage, this tab only). */
export interface ScratchDraft {
  v: 2;
  id: string;
  screen: Screen;
  /** The move being recorded now: always a free move of the new skill. */
  current: MoveChoice;
  /** The takes model of the current move, once three takes are in. */
  model: TakesModel | null;
  /** Recording ids of each move's takes in this draft, in order, so a reload finds them again (keyed by move id). */
  takeIds: Record<string, string[]>;
  /** Earlier moves of the same skill ("Add another move"). */
  moves: PlannedMove[];
  /** The wire skill the lesson is filed under: `general` for a new skill, or the catalogue skill it adds a lesson to. */
  skill: Skill;
  /** True when the draft adds a lesson to a catalogue skill (from its expert skill page): the skill name is fixed. */
  skillLocked: boolean;
  /** The skill's name as typed (or preset from a skill page); null until the expert edits it, so the default stands in. */
  skillName: string | null;
  /** One optional line about the skill, shown to the apprentice. */
  about: string;
  masterName: string;
  /** When this copy was last saved (ms since epoch): set on every save, so the newest of the local and the backend copy
   * wins on opening the flow. Absent on a draft that was never saved. */
  savedAt?: number;
}

/** The draft's shape version, sent with it to PUT /api/drafts/scratch/{id}. */
export const DRAFT_SCHEMA_VERSION = 2;

const KEY = 'apprentice.scratch.draft.v2';
/** Drafts of the old four-screen flow (with a Choose screen): dropped on sight, never opened. */
const OLD_KEYS = ['apprentice.scratch.draft.v1'];

function randomId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

/**
 * A new move of the new skill, as a free move. Its id is fixed before the first take, because every take is labelled
 * `<move_id>:rep<n>` while it records (docs/ideas/ML_PIPELINE_INTERFACE.md); the name people read can still change on
 * Publish without touching the labels.
 */
export function newMove(n: number, hands: Hands = 'right', skill: Skill = 'general'): MoveChoice {
  return { id: `free_${randomId()}`, moveId: null, name: defaultMoveName(n), description: FREE_INSTRUCTION, skill, hands, prop: 'none', motion: null, repetitions: TAKES_TARGET };
}

/** Which skill a new draft records for, when it starts from an expert skill page. */
export interface DraftSkill {
  skill: Skill;
  /** The skill's name: fixed for a catalogue skill, a preset for one the expert made. */
  name: string;
  locked: boolean;
}

export function newDraft(hands: Hands = 'right', forSkill: DraftSkill | null = null): ScratchDraft {
  const skill = forSkill?.skill ?? 'general';
  return {
    v: 2,
    id: randomId(),
    screen: 'record',
    current: newMove(1, hands, skill),
    model: null,
    takeIds: {},
    moves: [],
    skill,
    skillLocked: forSkill?.locked ?? false,
    skillName: forSkill?.name ?? null,
    about: '',
    masterName: '',
  };
}

const WIRE_SKILLS: Skill[] = ['table_tennis', 'piano', 'finnish_fingerspelling', 'shadow_puppets', 'general'];

/**
 * The skill a draft should record for, from the address an expert skill page links to: `?skill=table_tennis` adds a
 * lesson to a catalogue skill (its name fixed), `?skill=general&name=Pottery` to a skill the expert made (name preset).
 */
export function skillFromSearch(search: string): DraftSkill | null {
  const q = new URLSearchParams(search);
  const skill = q.get('skill') as Skill | null;
  if (!skill || !WIRE_SKILLS.includes(skill)) return null;
  if (skill !== 'general') return { skill, name: skillName(skill), locked: true };
  const name = q.get('name')?.trim();
  return name ? { skill, name, locked: false } : null;
}

/** Whether a draft holds nothing recorded yet, so starting another one loses nothing. */
export function isEmptyDraft(d: Pick<ScratchDraft, 'moves' | 'model' | 'takeIds' | 'current'>): boolean {
  return !d.moves.length && !d.model && !(d.takeIds[d.current.id]?.length ?? 0);
}

/** The draft saved in this tab, or null when there is none (or storage is blocked). An old-flow draft is dropped. */
/** A draft object read from storage or from the backend, checked and with older optional fields filled in; else null. */
export function parseDraft(raw: unknown): ScratchDraft | null {
  const d = raw as ScratchDraft | null;
  const ok = !!d && typeof d === 'object' && d.v === 2 && typeof d.id === 'string' && SCREENS.includes(d.screen) && Boolean(d.current?.id) && Array.isArray(d.moves);
  return ok ? { ...d, takeIds: d.takeIds ?? {}, about: d.about ?? '', skill: d.skill ?? 'general', skillLocked: d.skillLocked ?? false } : null;
}

/**
 * The draft saved on this device, or null when there is none (or storage is blocked). It lives in localStorage, so it
 * survives closing the tab; this tab's own copy in sessionStorage (a cache, written alongside) is read first. An old-flow
 * draft is dropped.
 * The backend keeps the same draft on disk (PUT /api/drafts/scratch/{id}), which is what a new device picks up.
 */
export function loadDraft(): ScratchDraft | null {
  try {
    for (const k of OLD_KEYS) window.sessionStorage.removeItem(k);
    const raw = window.sessionStorage.getItem(KEY) ?? window.localStorage.getItem(KEY);
    if (!raw) return null;
    return parseDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Saves the draft on this device with a fresh savedAt, and returns the copy that was saved. */
export function saveDraft(d: ScratchDraft, now = Date.now()): ScratchDraft {
  const stamped = { ...d, savedAt: now };
  try {
    const json = JSON.stringify(stamped);
    window.localStorage.setItem(KEY, json);
    window.sessionStorage.setItem(KEY, json);
  } catch {
    /* storage unavailable: the backend copy still keeps it */
  }
  return stamped;
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(KEY);
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Whether the backend's draft should replace the one this device opened with. A draft that came from this device's
 * storage gives way only to a copy saved later (another tab or laptop carried on); a freshly started one gives way to
 * any backend draft that holds work, so a new laptop or a cleared browser carries on where the expert left off.
 */
export function shouldAdoptServerDraft(local: ScratchDraft, server: ScratchDraft | null): server is ScratchDraft {
  if (!server) return false;
  if (local.savedAt === undefined) return !isEmptyDraft(server);
  return (server.savedAt ?? 0) > local.savedAt;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** One line on what a resumed draft holds: "Carry on where you left off: 2 takes of Move 1 recorded." Null when empty. */
export function resumeSummary(d: ScratchDraft): string | null {
  if (isEmptyDraft(d)) return null;
  const takes = d.takeIds[d.current.id]?.length ?? 0;
  const name = nameOr(d.current.name, defaultMoveName(d.moves.length + 1));
  const parts: string[] = [];
  if (d.moves.length) parts.push(`${plural(d.moves.length, 'move')} ready`);
  if (takes) parts.push(`${plural(takes, 'take')} of ${name} recorded`);
  else if (d.model) parts.push(`${name} recorded`);
  const skill = d.skillName?.trim();
  return `Carry on where you left off${skill ? ` on ${skill}` : ''}: ${parts.join(' and ')}.`;
}

/**
 * The screen a draft can actually show: replay needs the current move's takes model; publish needs at least one modelled
 * move. A stale or hand-edited draft therefore never opens on an empty screen.
 */
export function reachableScreen(d: Pick<ScratchDraft, 'screen' | 'model' | 'moves'>): Screen {
  if (d.screen === 'replay' && !d.model) return 'record';
  if (d.screen === 'publish' && !d.model && !d.moves.length) return 'record';
  return d.screen;
}

/**
 * The step_id a scratch take is stored with: the move id and the repetition, `free_k3x9q2ab:rep2`. This is the label
 * the training-data pipeline parses (docs/ideas/ML_PIPELINE_INTERFACE.md), so each take stays one labelled example.
 */
export function repStepId(moveId: string, rep: number): string {
  return `${moveId}:rep${rep}`;
}

/** The repetition number in a scratch take's step_id, or 0 when it has none. */
export function repOf(stepId: string | null | undefined): number {
  const at = stepId?.lastIndexOf(':rep') ?? -1;
  const n = at >= 0 ? Number(stepId!.slice(at + 4)) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Which hands set-ups the expert may pick for a move. A catalogue move made for two hands stays two-handed; a one-handed
 * move may be done with either hand; a free move may also use both. An empty list means nothing to ask.
 */
export function handsOptions(c: Pick<MoveChoice, 'moveId' | 'hands'>): Hands[] {
  if (c.moveId === null) return ['right', 'left', 'both'];
  return c.hands === 'both' ? [] : ['right', 'left'];
}

export const HANDS_SHORT: Record<Hands, string> = { right: 'Right hand', left: 'Left hand', both: 'Both hands' };

const FINGER_WORD: Record<Finger, string> = { thumb: 'thumb', index: 'index finger', middle: 'middle finger', ring: 'ring finger', little: 'little finger' };

export type TakeWord = 'reference' | 'close' | 'near' | 'strays';

/** One take as the expert reads it after the model: its number, how it sits against the reference, and whether to redo it. */
export interface TakeReading {
  id: string;
  n: number;
  isReference: boolean;
  /** 0..100 consistency against the reference (100 for the reference). */
  score: number;
  word: TakeWord;
  outlier: boolean;
}

/** The takes model in plain language for the Record and Replay screens. */
export interface ModelReading {
  referenceN: number;
  /** One short sentence on how alike the takes are. */
  headline: string;
  takes: TakeReading[];
  outliers: TakeReading[];
  /** "Your index finger was steadiest, so it will be judged strictly; your little finger varied most and gets more room." */
  fingers: string;
}

export const TAKE_WORD_LABEL: Record<TakeWord, string> = { reference: 'Reference', close: 'Close match', near: 'A little different', strays: 'Strays' };

function wordFor(score: number, isReference: boolean, outlier: boolean): TakeWord {
  if (isReference) return 'reference';
  if (outlier || score < 60) return 'strays';
  return score >= 85 ? 'close' : 'near';
}

/** How alike the takes are, in one sentence, from the model's 0..100 consistency. */
export function consistencyHeadline(consistency: number): string {
  if (consistency >= 85) return 'Very consistent: your takes agree closely.';
  if (consistency >= 70) return 'Consistent, with a little natural variation.';
  if (consistency >= 55) return 'Some variation between takes, so the apprentice gets a little more room.';
  return 'Your takes differ quite a lot. Another take or two would sharpen the lesson.';
}

/** The steadiest and loosest finger as one sentence about how the apprentice will be judged. */
export function fingersSentence(model: Pick<TakesModel, 'steadiest_finger' | 'loosest_finger'>): string {
  const steady = FINGER_WORD[model.steadiest_finger];
  const loose = FINGER_WORD[model.loosest_finger];
  if (model.steadiest_finger === model.loosest_finger) return `Your ${steady} sets the pace for how closely the apprentice is judged.`;
  return `Your ${steady} was steadiest, so it will be judged strictly; your ${loose} varied most and gets more room.`;
}

/** Reads a takes model for people: the reference take by number, a consistency sentence, each take's word, outliers. */
export function readModel(model: TakesModel, takeIds: string[]): ModelReading {
  const numberOf = (id: string) => takeIds.indexOf(id) + 1;
  const takes: TakeReading[] = model.takes.map((t) => ({
    id: t.recording_id,
    n: numberOf(t.recording_id),
    isReference: t.is_reference,
    score: Math.round(t.score),
    word: wordFor(t.score, t.is_reference, t.outlier),
    outlier: t.outlier,
  }));
  return {
    referenceN: numberOf(model.reference_recording_id),
    headline: consistencyHeadline(model.consistency),
    takes,
    outliers: takes.filter((t) => t.outlier),
    fingers: fingersSentence(model),
  };
}

/** Whether a stored model still describes exactly these takes (same ids, same order). */
export function modelMatches(model: TakesModel | null, ids: string[]): model is TakesModel {
  return Boolean(model) && (model as TakesModel).take_ids.join(',') === ids.join(',');
}

/** The lesson step for a recorded move: the model's reference take, every take id, and its per-finger tolerance. */
export function stepFromModel(c: MoveChoice, model: TakesModel): Step {
  const fingers = {} as Record<Finger, number>;
  for (const f of FINGERS) fingers[f] = model.tolerance.finger_angle_deg[f];
  return {
    id: newStepId(),
    title: c.name,
    instruction: c.description,
    move_id: c.moveId,
    hands: c.hands,
    prop: c.prop,
    motion: c.motion,
    reference_recording_id: model.reference_recording_id,
    take_ids: [...model.take_ids],
    repetitions: Math.max(1, model.take_ids.length),
    tolerance: { angle_deg: model.tolerance.angle_deg, timing_ms: model.tolerance.timing_ms, finger_angle_deg: fingers },
    video_url: null,
  };
}

/** The published lesson's title: the new skill's name, or for a catalogue skill its name and the moves. */
export function lessonTitle(d: Pick<ScratchDraft, 'skillLocked' | 'skillName'>, moveNames: string[]): string {
  const skill = nameOr(d.skillName, DEFAULT_SKILL_NAME);
  return d.skillLocked && moveNames.length ? `${skill}: ${moveNames.join(', ')}` : skill;
}

/** A name as typed, or its default when left blank. */
export function nameOr(typed: string | null | undefined, fallback: string): string {
  const t = (typed ?? '').trim();
  return t || fallback;
}

/**
 * The lesson a scratch draft publishes, each recorded move one step named by the expert. A new skill is filed as `general`
 * (the contract's skill list is fixed) and its name is the lesson title, which is what groups its lessons on the shelf. A
 * lesson added to a catalogue skill keeps that skill and is titled "Table tennis: Topspin loop" after its moves. A
 * one-line description, when given, is the summary and the instruction of a single-move lesson.
 */
export function scratchLesson(d: Pick<ScratchDraft, 'skill' | 'skillLocked' | 'skillName' | 'about' | 'masterName'>, planned: PlannedMove[]): LessonDraft {
  const about = d.about.trim();
  const steps = planned.map((p, i) => {
    const step = stepFromModel({ ...p.choice, name: nameOr(p.choice.name, defaultMoveName(i + 1)) }, p.model);
    return about && planned.length === 1 ? { ...step, instruction: about } : step;
  });
  return {
    title: lessonTitle(d, steps.map((s) => s.title)),
    skill: d.skill,
    summary: about || `Recorded by hand: ${steps.map((s) => s.title).join(', ')}.`,
    master_name: d.masterName.trim() || 'The expert',
    source: 'scratch',
    steps,
    test: null,
  };
}

/**
 * The hand the wooden hand shows on the Replay screen. A real glove being worn (anything but the simulator or a replayed
 * stream) is followed live, as the apprentice's will be. Otherwise the live stream is a free-running stand-in with no
 * relation to the take, so the wooden hand takes the take's own frame at the player's clock and the two hands stay
 * frame for frame together.
 */
export function replayWornHand<T>(live: { source: string; hands: (T & { side: string })[] } | null, side: string, played: T | null): T | null {
  if (live && live.source !== 'simulator' && live.source !== 'replay') return live.hands.find((h) => h.side === side) ?? played;
  return played;
}
