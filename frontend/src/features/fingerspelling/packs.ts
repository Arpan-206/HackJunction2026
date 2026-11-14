/**
 * Fingerspelling packs: letters live in packs, one alphabet per pack (docs/CONTRACT.md, "Fingerspelling packs"). A pack
 * comes from GET /fingerspelling/packs, with the bundled copy of `backend/app/data/fingerspelling_packs.json` as the
 * offline fallback. A recorded letter has a shape the drill can score against: its move (the ASL letters) or the curls a
 * person recorded (the slot kit, the camera). A letter that is not recorded yet has no shape at all. It shows as
 * "not recorded yet" and the drill skips it: nothing is ever scored against a guess.
 */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { FingerspellingPack, MotionSpec, PackLetter } from '../../api/types';
import { FINGERS } from '../../api/types';
import packsJson from '../../mock/data/fingerspelling-packs.json';
import { curlDistance, lettersMotion, LETTER_MS, letterShape, TWIN_CURL, twinReason as aslTwinReason, type Curls } from './chart';

export const BUNDLED_PACKS = (packsJson as unknown as { packs: FingerspellingPack[] }).packs;
export const DEFAULT_PACK_ID = 'asl';
export const NOT_RECORDED = 'Not recorded yet';

/** One letter of a pack as the screens show it. `motion` and `curls` are null exactly when the letter is not recorded. */
export interface PackLetterView {
  letter: string;
  recorded: boolean;
  recordedBy: string | null;
  reference: string | null;
  recordedAt: string | null;
  lessonId: string | null;
  /** The written shape for a seeded letter, or null (a recorded take has no words, only its pose). */
  shape: string | null;
  movement: string | null;
  motion: MotionSpec | null;
  curls: Curls | null;
}

function viewOf(l: PackLetter): PackLetterView {
  const base = { letter: l.letter, recordedBy: l.recorded_by, reference: l.reference, recordedAt: l.recorded_at, lessonId: l.lesson_id };
  if (l.status !== 'recorded') return { ...base, recorded: false, shape: null, movement: null, motion: null, curls: null };
  const seeded = l.move_id ? letterShape(l.move_id.replace(/^fs_/, '')) : null;
  if (seeded && l.move_id === `fs_${seeded.letter.toLowerCase()}`) {
    return { ...base, recorded: true, shape: seeded.shape, movement: seeded.movement, motion: seeded.motion, curls: seeded.curls };
  }
  if (l.pose) {
    const curls = { ...l.pose };
    return { ...base, recorded: true, shape: null, movement: null, motion: { preset: 'hold_pose', pose: curls }, curls };
  }
  // A recorded letter whose move or pose this build cannot read: show it as recorded, but never score it.
  return { ...base, recorded: true, shape: null, movement: null, motion: null, curls: null };
}

export interface PackView {
  pack: FingerspellingPack;
  letters: PackLetterView[];
  recorded: number;
}

export function packView(pack: FingerspellingPack): PackView {
  const letters = pack.letters.map(viewOf);
  return { pack, letters, recorded: letters.filter((l) => l.recorded).length };
}

export function letterInPack(view: PackView, letter: string): PackLetterView | null {
  const want = normaliseWord(letter)[0];
  return view.letters.find((l) => l.letter === want) ?? null;
}

/** Usable for the drill: recorded and with a shape to score against. */
export const scorable = (l: PackLetterView | null): l is PackLetterView & { motion: MotionSpec; curls: Curls } => Boolean(l && l.recorded && l.motion && l.curls);

/* ---------- words ---------- */

/**
 * The letters of a word, upper case in Finnish rules, accents kept: "Äiti" gives Ä, I, T, I. Anything that is not a
 * letter (spaces, digits, punctuation) is dropped. Å, Ä and Ö stay themselves; they are never folded to A or O.
 */
export function normaliseWord(word: string): string[] {
  return [...word.normalize('NFC').toLocaleUpperCase('fi-FI')].filter((ch) => /\p{L}/u.test(ch));
}

export type PlanKind = 'recorded' | 'not_recorded' | 'not_in_pack';

export interface PlanItem {
  char: string;
  kind: PlanKind;
  view: PackLetterView | null;
}

/** How a word spells in a pack: each letter recorded (drilled and scored), not recorded yet, or not in the pack (skipped). */
export function spellPlan(word: string, view: PackView): PlanItem[] {
  return normaliseWord(word).map((char) => {
    const l = view.letters.find((x) => x.letter === char) ?? null;
    if (!l) return { char, kind: 'not_in_pack', view: null };
    return { char, kind: scorable(l) ? 'recorded' : 'not_recorded', view: l };
  });
}

/** The reference motion for the recorded letters of a plan, the same rule the seeded word lessons use. */
export function planMotion(plan: PlanItem[], ms = LETTER_MS): MotionSpec {
  return lettersMotion(plan.filter((p) => p.kind === 'recorded' && p.view?.motion).map((p) => p.view?.motion as MotionSpec), ms);
}

/** Plain words for a skipped letter of a plan. */
export function skipReason(item: PlanItem, packName: string): string {
  return item.kind === 'not_in_pack' ? `${item.char} is not in ${packName}.` : `${item.char}: ${NOT_RECORDED.toLowerCase()}.`;
}

/* ---------- twins ---------- */

/** Recorded letters of the pack the gloves read the same as `letter` (curls closer than TWIN_CURL on every finger). */
export function packTwins(view: PackView, letter: string): string[] {
  const me = letterInPack(view, letter);
  if (!me?.curls) return [];
  return view.letters.filter((l) => l.letter !== me.letter && l.curls && curlDistance(l.curls, me.curls as Curls) < TWIN_CURL).map((l) => l.letter);
}

/** Groups of recorded letters the gloves cannot separate: letters joined by any chain of twins, in pack order. */
export function packTwinGroups(view: PackView): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const l of view.letters) {
    if (seen.has(l.letter) || !l.curls) continue;
    const group: string[] = [];
    const todo = [l.letter];
    while (todo.length) {
      const x = todo.pop() as string;
      if (seen.has(x)) continue;
      seen.add(x);
      group.push(x);
      todo.push(...packTwins(view, x));
    }
    if (group.length > 1) out.push(group.sort((a, b) => a.localeCompare(b, 'fi')));
  }
  return out;
}

/** Why two letters look alike to the gloves: the ASL sources' words, or a plain line for other packs. */
export function packTwinReason(view: PackView, a: string, b: string): string {
  if (view.pack.id === DEFAULT_PACK_ID) return aslTwinReason(a, b);
  return `${a} and ${b} have nearly the same finger curls; they differ in ways the gloves do not sense.`;
}

/** Curl bar label, thumb to little finger, in percent. */
export function curlsLabel(c: Curls): string {
  return FINGERS.map((f) => Math.round(c[f] * 100)).join(', ');
}

/* ---------- loading ---------- */

export interface PacksState {
  packs: PackView[];
  /** True while the API has not answered; the bundled packs show meanwhile. */
  loading: boolean;
  /** True when the API failed and the bundled packs are shown. */
  offline: boolean;
}

/** The packs from the API, with the bundled copy shown while loading and when the backend cannot be reached. */
export function usePacks(): PacksState {
  const [state, setState] = useState<PacksState>(() => ({ packs: BUNDLED_PACKS.map(packView), loading: true, offline: false }));
  useEffect(() => {
    const ctl = new AbortController();
    api
      .fingerspellingPacks(ctl.signal)
      .then((packs) => setState({ packs: packs.map(packView), loading: false, offline: false }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState((s) => ({ ...s, loading: false, offline: true }));
      });
    return () => ctl.abort();
  }, []);
  return state;
}
