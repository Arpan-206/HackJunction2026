import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEED_LESSONS } from '../src/mock/seed';
import { readLog, setLog } from '../src/features/shared/practiceLog';
import { addDays, dayKey, daysPractised, deriveStep, isDue, syntheticScore } from '../src/features/apprentice/pipeline/progress';
import { buildDemoHistory, clearPracticeHistory, DEMO_OFF, resetDemoHistory, seedDemoHistoryIfEmpty, shouldSeed } from '../src/features/apprentice/pipeline/demoHistory';
import { currentStreak, dayButtonLabel, dayDetail, practiceMinutes, streakLabel } from '../src/features/apprentice/pipeline/streak';
import { buildSkills, progressBar, skillName, skillProgress } from '../src/features/apprentice/skills/catalogue';
import { QUOTES, quoteCredit, quoteOfDay } from '../src/features/apprentice/library/quotes';

/** The hackathon Saturday, and two other days the demo must still work on. */
const SATURDAY = new Date(2026, 10, 14, 15, 30);
const MONDAY = new Date(2026, 10, 16, 10, 0);
const EARLY = new Date(2026, 10, 18, 0, 20);

const empty = () => ({ attempts: {}, tests: {} });

describe('current streak', () => {
  const T = '2026-11-14';
  it('counts the run of days ending today', () => {
    const s = currentStreak([addDays(T, -5), addDays(T, -2), addDays(T, -1), T], T);
    expect(s.length).toBe(3);
    expect(s.days).toEqual(['2026-11-12', '2026-11-13', '2026-11-14']);
    expect(s.includesToday).toBe(true);
    expect(streakLabel(s)).toBe('3-day streak');
  });

  it('keeps a run that ended yesterday alive while today is open', () => {
    const s = currentStreak([addDays(T, -3), addDays(T, -2), addDays(T, -1)], T);
    expect(s.length).toBe(3);
    expect(s.includesToday).toBe(false);
  });

  it('is broken by a missed day', () => {
    const s = currentStreak([addDays(T, -3), addDays(T, -2)], T);
    expect(s.length).toBe(0);
    expect(streakLabel(s)).toBe('Start a streak today');
  });

  it('works across a month boundary', () => {
    expect(currentStreak(['2026-11-30', '2026-12-01'], '2026-12-01').length).toBe(2);
  });
});

describe('demo history, relative to today', () => {
  for (const now of [SATURDAY, MONDAY, EARLY]) {
    const today = dayKey(now);
    const h = buildDemoHistory(SEED_LESSONS, now);
    const all = Object.values(h.attempts).flat();

    it(`ends in a 3-day streak on ${today}`, () => {
      const s = currentStreak(daysPractised(all), today);
      expect(s.length).toBe(3);
      expect(s.includesToday).toBe(true);
      expect(all.every((a) => a.demo && a.at && new Date(a.at).getTime() <= now.getTime())).toBe(true);
    });

    it(`leaves nothing due on ${today} and matches the card progress`, () => {
      for (const l of SEED_LESSONS) {
        for (const st of l.steps) expect(isDue(deriveStep(st.id, h.attempts[l.id] ?? []), today)).toBe(false);
      }
      const mastered = Object.fromEntries(buildSkills(SEED_LESSONS).map((s) => [s.id, skillProgress(s.courses, h.attempts, today)]));
      expect([mastered.table_tennis.mastered, mastered.table_tennis.total]).toEqual([2, 3]);
      expect([mastered.piano.mastered, mastered.piano.total]).toEqual([1, 2]);
      // Fingerspelling and shadow puppets are left untouched for a live first session.
      expect(mastered.fingerspelling).toMatchObject({ mastered: 0, total: 2, started: false });
      expect(h.attempts['seed-fingerspelling-words'] ?? []).toHaveLength(0);
      expect(Object.keys(h.attempts).some((id) => id.includes('finnish'))).toBe(false);
      expect(mastered.shadow_puppets).toMatchObject({ mastered: 0, total: 5, started: false });
      expect(h.attempts['seed-shadow-puppets'] ?? []).toHaveLength(0);
      expect(h.tests['seed-shadow-puppets'] ?? []).toHaveLength(0);
      expect(progressBar(mastered.shadow_puppets).label).toBe('5 lessons');
    });
  }

  it('describes Thursday: two lessons, one mastered, time and best score', () => {
    const h = buildDemoHistory(SEED_LESSONS, SATURDAY);
    const d = dayDetail('2026-11-12', SEED_LESSONS, h.attempts, h.tests, skillName);
    expect(d.lessons.map((l) => `${l.skill}: ${l.lesson}`)).toEqual([
      'Piano: Hand position',
      'Table tennis: The shakehand grip',
    ]);
    expect(d.lessons.filter((l) => l.mastered)).toHaveLength(1);
    expect(d.lessons[0].review).toBe(true);
    expect(d.best).toBe(89);
    expect(d.minutes).toBeGreaterThan(10);
    expect(dayButtonLabel(d.day, d.lessons.length, false)).toBe('Thursday 12 November, practised 2 lessons');
    const rest = dayDetail('2026-11-11', SEED_LESSONS, h.attempts, h.tests, skillName);
    expect(rest.lessons).toHaveLength(0);
    expect(rest.best).toBeNull();
    expect(dayButtonLabel(rest.day, 0, false)).toBe('Wednesday 11 November, no practice');
  });

  it("keeps today's account full without shadow puppets or fingerspelling", () => {
    const h = buildDemoHistory(SEED_LESSONS, SATURDAY);
    const d = dayDetail('2026-11-14', SEED_LESSONS, h.attempts, h.tests, skillName);
    expect(d.lessons.length).toBe(2);
    expect(d.lessons.some((l) => l.skill === 'Shadow puppets' || l.skill === 'Fingerspelling')).toBe(false);
    expect(d.lessons.filter((l) => l.mastered)).toHaveLength(1);
  });

  it('skips lessons the library no longer has', () => {
    const h = buildDemoHistory([SEED_LESSONS[0]], SATURDAY);
    expect(Object.keys(h.attempts)).toEqual([SEED_LESSONS[0].id]);
  });

  it('estimates minutes per sitting', () => {
    expect(practiceMinutes([])).toBe(0);
    expect(practiceMinutes(['2026-11-14T10:00:00Z', '2026-11-14T10:10:00Z'])).toBe(12);
    // Two sittings an hour apart are not one long one.
    expect(practiceMinutes(['2026-11-14T10:00:00Z', '2026-11-14T11:00:00Z'])).toBe(3);
  });
});

describe('seed only when there is no real practice', () => {
  const real = { attempts: { 'seed-piano': [{ step_id: 'seed-piano-position', score: syntheticScore(70), at: '2026-11-10T10:00:00Z' }] }, tests: {} };
  const demoOnly = buildDemoHistory(SEED_LESSONS, SATURDAY);

  it('decides from the log and the mark', () => {
    expect(shouldSeed(empty(), null, '2026-11-14')).toBe(true);
    expect(shouldSeed(real, null, '2026-11-14')).toBe(false);
    expect(shouldSeed({ attempts: {}, tests: { l: [{ passed: true, overall: 90, at: '2026-11-10T10:00:00Z' }] } }, null, '2026-11-14')).toBe(false);
    expect(shouldSeed(demoOnly, '2026-11-14', '2026-11-14')).toBe(false);
    // Demo history from an earlier day is refreshed so the streak still ends today.
    expect(shouldSeed(demoOnly, '2026-11-13', '2026-11-14')).toBe(true);
    expect(shouldSeed(empty(), DEMO_OFF, '2026-11-14')).toBe(false);
    // A demo-only log seeded under an older key version (no mark under the current key) is rewritten.
    expect(shouldSeed(demoOnly, null, '2026-11-14')).toBe(true);
  });

  describe('on the device', () => {
    let store: Record<string, string>;
    beforeEach(() => {
      store = {};
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => void (store[k] = v),
        removeItem: (k: string) => void delete store[k],
      });
      setLog(empty());
    });
    afterEach(() => vi.unstubAllGlobals());

    it('never writes over real practice', () => {
      setLog(real);
      expect(seedDemoHistoryIfEmpty(SEED_LESSONS, SATURDAY)).toBe(false);
      expect(readLog()).toEqual(real);
    });

    it('seeds an empty log once a day, and the resets work', () => {
      expect(seedDemoHistoryIfEmpty(SEED_LESSONS, SATURDAY)).toBe(true);
      expect(Object.keys(readLog().attempts).sort()).toEqual(['seed-piano', 'seed-table-tennis']);
      expect(seedDemoHistoryIfEmpty(SEED_LESSONS, SATURDAY)).toBe(false);
      expect(seedDemoHistoryIfEmpty(SEED_LESSONS, MONDAY)).toBe(true);
      clearPracticeHistory();
      expect(readLog()).toEqual(empty());
      expect(seedDemoHistoryIfEmpty(SEED_LESSONS, MONDAY)).toBe(false);
      resetDemoHistory();
      expect(seedDemoHistoryIfEmpty(SEED_LESSONS, MONDAY)).toBe(true);
    });
  });
});

describe('skill progress bar', () => {
  it('is the fraction of lessons mastered', () => {
    expect(progressBar({ mastered: 2, total: 3, started: true })).toEqual({ fraction: 2 / 3, percent: 67, label: '2 of 3 lessons mastered', complete: false });
    expect(progressBar({ mastered: 3, total: 7, started: true }).percent).toBe(43);
  });

  it('turns complete (gold) only when every lesson is mastered', () => {
    expect(progressBar({ mastered: 2, total: 2, started: true }).complete).toBe(true);
    expect(progressBar({ mastered: 1, total: 1, started: true }).label).toBe('1 of 1 lesson mastered');
    expect(progressBar({ mastered: 0, total: 0, started: false })).toEqual({ fraction: 0, percent: 0, label: '0 lessons', complete: false });
  });

  it('shows just the lesson count before the first rep', () => {
    expect(progressBar({ mastered: 0, total: 5, started: false })).toMatchObject({ fraction: 0, label: '5 lessons', complete: false });
    expect(progressBar({ mastered: 0, total: 5, started: true }).label).toBe('0 of 5 lessons mastered');
  });
});

describe('quotes', () => {
  it('every quote has its text and full source', () => {
    expect(QUOTES.length).toBe(9);
    for (const q of QUOTES) {
      for (const field of [q.text, q.author, q.work, q.section, q.translator]) expect(field.trim().length).toBeGreaterThan(0);
      expect(q.text.includes(String.fromCharCode(0x2014))).toBe(false);
      expect(quoteCredit(q)).toBe(`${q.author}, ${q.work}`);
    }
  });

  it('starts from the verified Cennini line', () => {
    expect(QUOTES[0].text).toBe(
      'And begin to submit yourself to the direction of a master for instruction as early as you can; and do not leave the master until you have to.',
    );
    expect(quoteCredit(QUOTES[0])).toBe("Cennino Cennini, Il Libro dell'Arte");
  });

  it('picks one a day and cycles through them all', () => {
    expect(quoteOfDay('2026-11-14')).toBe(quoteOfDay('2026-11-14'));
    expect(quoteOfDay('2026-11-15')).not.toBe(quoteOfDay('2026-11-14'));
    const seen = new Set(Array.from({ length: QUOTES.length }, (_, i) => quoteOfDay(addDays('2026-11-14', i))));
    expect(seen.size).toBe(QUOTES.length);
  });
});
