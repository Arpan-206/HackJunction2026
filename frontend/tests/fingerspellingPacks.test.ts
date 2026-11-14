import { describe, expect, it } from 'vitest';
import type { FingerspellingPack } from '../src/api/types';
import { wordMotion } from '../src/features/fingerspelling/chart';
import {
  BUNDLED_PACKS,
  normaliseWord,
  packTwinGroups,
  packTwins,
  packView,
  planMotion,
  scorable,
  skipReason,
  spellPlan,
} from '../src/features/fingerspelling/packs';

const asl = packView(BUNDLED_PACKS.find((p) => p.id === 'asl') as FingerspellingPack);
const fi = packView(BUNDLED_PACKS.find((p) => p.id === 'fi') as FingerspellingPack);

describe('fingerspelling packs', () => {
  it('holds the ASL alphabet and an empty Finnish pack', () => {
    expect(asl.pack.name).toBe('ASL fingerspelling alphabet');
    expect(asl.recorded).toBe(26);
    expect(fi.pack.name).toBe('Finnish fingerspelling (sormiaakkoset)');
    expect(fi.letters.map((l) => l.letter)).toEqual(['S', 'U', 'O', 'M', 'I', 'Ä', 'Ö']);
    expect(fi.recorded).toBe(0);
  });

  it('never gives a letter that is not recorded yet a pose or a motion', () => {
    for (const l of fi.letters) {
      expect(l.recorded).toBe(false);
      expect(l.motion).toBeNull();
      expect(l.curls).toBeNull();
      expect(scorable(l)).toBe(false);
    }
    expect(packTwins(fi, 'S')).toEqual([]);
    expect(packTwinGroups(fi)).toEqual([]);
  });

  it('keeps Å, Ä and Ö as letters of their own', () => {
    expect(normaliseWord('äiti')).toEqual(['Ä', 'I', 'T', 'I']);
    expect(normaliseWord('Åbo, 2 öitä!')).toEqual(['Å', 'B', 'O', 'Ö', 'I', 'T', 'Ä']);
    // A decomposed Ä (A plus a combining mark) is the same letter as a composed one.
    expect(normaliseWord('Ä')).toEqual(['Ä']);
  });

  it('spells a Finnish word without scoring a single guessed letter', () => {
    const plan = spellPlan('äiti', fi);
    expect(plan.map((p) => p.kind)).toEqual(['not_recorded', 'not_recorded', 'not_in_pack', 'not_recorded']);
    expect(planMotion(plan)).toEqual({ preset: 'keyframes', keys: [] });
    expect(skipReason(plan[0], fi.pack.name)).toBe('Ä: not recorded yet.');
    expect(skipReason(plan[2], fi.pack.name)).toBe('T is not in Finnish fingerspelling (sormiaakkoset).');
  });

  it('spells ASL words as before, and skips Ä there as not in the pack', () => {
    const plan = spellPlan('Junction', asl);
    expect(plan.every((p) => p.kind === 'recorded')).toBe(true);
    expect(planMotion(plan)).toEqual(wordMotion('JUNCTION'));
    expect(spellPlan('PÄÄ', asl).map((p) => p.kind)).toEqual(['recorded', 'not_in_pack', 'not_in_pack']);
    expect(packTwinGroups(asl)).toContainEqual(['H', 'R', 'U', 'V']);
  });

  it('drills a letter a person recorded, from its recorded curls', () => {
    const pose = { thumb: 0.4, index: 0.1, middle: 0.9, ring: 0.9, little: 0.9 };
    const recorded = packView({
      ...fi.pack,
      letters: fi.pack.letters.map((l) =>
        l.letter === 'Ä' ? { ...l, status: 'recorded' as const, recorded_by: 'Aino', reference: fi.pack.default_reference.url, recorded_at: '2026-11-15', lesson_id: 'x', pose } : l,
      ),
    });
    expect(recorded.recorded).toBe(1);
    const plan = spellPlan('ÄS', recorded);
    expect(plan.map((p) => p.kind)).toEqual(['recorded', 'not_recorded']);
    expect(planMotion(plan)).toEqual({ preset: 'keyframes', keys: [{ pose, ms: 1200 }] });
  });
});
