import { describe, expect, it } from 'vitest';
import type { ScoreResult } from '../src/api/types';
import type { LoggedAttempt, LoggedStage, LoggedTest } from '../src/features/shared/practiceLog';
import { botGoodChance } from '../src/features/apprentice/test/TableTennisRally/rally';
import { botPerformance, schedulePhrase, DEFAULT_PHRASE, DEFAULT_BEAT_S } from '../src/features/apprentice/test/PianoPlayAlong/piano';
import { policyForStage } from '../src/features/apprentice/training/coach/fade';
import {
  addDays, BOT_SKILL, dayKey, deriveLesson, deriveStep, isDue, startingPoint, syntheticScore, weekMarks, weekSummary,
} from '../src/features/apprentice/pipeline/progress';
import {
  applyRep, DEFAULT_CONFIG, DEMO_CONFIG, finishWatch, frayLevels, initialState, isClean, replay, type StageState,
} from '../src/features/apprentice/pipeline/stages';
import { buildDemoHistory } from '../src/features/apprentice/pipeline/demoHistory';
import { repLine, setLine, stageLine } from '../src/features/apprentice/pipeline/coachLines';

const clean = syntheticScore(90);
const messy = syntheticScore(60);

function run(state: StageState, scores: ScoreResult[], cfg = DEFAULT_CONFIG) {
  let s = state;
  const events: string[] = [];
  for (const sc of scores) {
    const o = applyRep(s, sc, cfg);
    s = o.state;
    events.push(o.event);
  }
  return { s, events };
}

describe('clean rep', () => {
  it('needs tolerance and the pass score', () => {
    expect(isClean({ within_tolerance: true, overall: 80 })).toBe(true);
    expect(isClean({ within_tolerance: true, overall: 79 })).toBe(false);
    expect(isClean({ within_tolerance: false, overall: 95 })).toBe(false);
    expect(isClean({ within_tolerance: true, overall: 70 }, 65)).toBe(true);
  });
});

describe('stage machine', () => {
  it('watch is unscored and moves to the strings', () => {
    const w = initialState();
    expect(applyRep(w, clean).state).toBe(w);
    expect(finishWatch(w).stage).toBe('strings');
  });

  it('advances after the needed clean reps in a row, one stage at a time', () => {
    const { s, events } = run(initialState('strings'), [clean, clean, clean]);
    expect(s.stage).toBe('ghost');
    expect(events).toEqual(['none', 'none', 'advanced']);
    expect(run(s, [clean, clean, clean]).s.stage).toBe('blind');
  });

  it('uses two clean reps in demo mode', () => {
    expect(run(initialState('strings'), [clean, clean], DEMO_CONFIG).s.stage).toBe('ghost');
  });

  it('a messy rep resets the combo', () => {
    const { s } = run(initialState('strings'), [clean, clean, messy]);
    expect(s.combo).toBe(0);
    expect(s.stage).toBe('strings');
  });

  it('masters the step once blind is cleared, and says so once', () => {
    const { s, events } = run(initialState('blind'), [clean, clean, clean, clean, clean, clean]);
    expect(s.mastered).toBe(true);
    expect(s.stage).toBe('blind');
    expect(events.filter((e) => e === 'mastered')).toHaveLength(1);
  });

  it('drops one stage after two failed sets in a row', () => {
    const failedSet = [messy, clean, messy, clean, messy];
    const first = run(initialState('ghost'), failedSet);
    expect(first.s.stage).toBe('ghost');
    expect(first.s.failedSets).toBe(1);
    expect(first.events[4]).toBe('set_done');
    const second = run(first.s, failedSet);
    expect(second.s.stage).toBe('strings');
    expect(second.events[4]).toBe('dropped');
  });

  it('a good set clears the failed-set count and the strings stage never drops', () => {
    const a = run(initialState('blind'), [messy, messy, messy, messy, messy]);
    expect(a.s.failedSets).toBe(1);
    const b = run(a.s, [clean, clean, messy, clean, messy]);
    expect(b.s.failedSets).toBe(2 > DEFAULT_CONFIG.failedSetsToDrop ? 0 : b.s.failedSets);
    const c = run(initialState('strings'), [messy, messy, messy, messy, messy, messy, messy, messy, messy, messy]);
    expect(c.s.stage).toBe('strings');
  });

  it('remembers the fingers that were wrong for the ghost stage', () => {
    const bad = { ...messy, per_finger: { ...messy.per_finger, ring: 40, index: 95 } };
    const o = applyRep(initialState('strings'), bad);
    expect(o.state.wrongFingers).toContain('ring');
    expect(o.state.wrongFingers).not.toContain('index');
    expect(policyForStage('ghost', o.state.wrongFingers).focus).toEqual(o.state.wrongFingers);
  });

  it('maps stages to how much guidance is drawn', () => {
    expect(policyForStage('watch')).toMatchObject({ liveCoach: false, strings: 'none', showMaster: true });
    expect(policyForStage('strings')).toMatchObject({ liveCoach: true, strings: 'all', showMaster: true });
    expect(policyForStage('ghost')).toMatchObject({ liveCoach: true, strings: 'off-only', showMaster: true });
    expect(policyForStage('blind')).toMatchObject({ liveCoach: false, strings: 'none', showMaster: false });
  });

  it('replays a log to the same state', () => {
    const log = [clean, clean, clean, clean].map((score, i) => ({ stage: (i < 3 ? 'strings' : 'ghost') as LoggedStage, score }));
    expect(replay(log).stage).toBe('ghost');
    expect(replay([]).stage).toBe('watch');
    expect(replay([{ score: clean }]).stage).toBe('watch');
  });
});

describe('clean-rep combo and the strings', () => {
  it('frays from nothing to fully frayed as the combo fills', () => {
    expect(frayLevels(0, 3).every((v) => v === 0)).toBe(true);
    expect(frayLevels(3, 3).every((v) => v === 1)).toBe(true);
    const mid = frayLevels(1, 3);
    expect(mid[0]).toBeGreaterThan(mid[4]);
    expect(mid[0]).toBeGreaterThan(0);
    expect(frayLevels(2, 3)[0]).toBeGreaterThanOrEqual(mid[0]);
  });

  it('never leaves 0 to 1 and copes with a zero need', () => {
    expect(frayLevels(9, 3).every((v) => v === 1)).toBe(true);
    expect(frayLevels(1, 0).every((v) => v === 0)).toBe(true);
  });

  it('reports the snap on advancing from the strings', () => {
    const o = applyRep({ ...initialState('strings'), combo: 2 }, clean);
    expect(o.event).toBe('advanced');
    expect(stageLine(o)).toMatch(/strings are cut/i);
  });
});

/** Builds a blind log: each entry is [step, daysAgo, hour, overall]. */
function blind(now: Date, rows: [string, number, number, number][], stage: LoggedStage = 'blind'): LoggedAttempt[] {
  return rows
    .map(([step_id, daysAgo, hour, overall]) => {
      const d = new Date(now);
      d.setDate(d.getDate() - daysAgo);
      d.setHours(hour, 0, 0, 0);
      return { step_id, stage, at: d.toISOString(), score: syntheticScore(overall) } as LoggedAttempt;
    })
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
}

const NOW = new Date(2026, 5, 17, 12, 0, 0);
const TODAY = dayKey(NOW);

describe('Leitner review', () => {
  it('masters on three clean blind reps in a row and schedules +1 day', () => {
    const m = deriveStep('a', blind(NOW, [['a', 3, 9, 85], ['a', 3, 10, 88], ['a', 3, 11, 90]]));
    expect(m.mastered_at).not.toBeNull();
    expect(m.box).toBe(0);
    expect(m.next_due).toBe(addDays(dayKey(addDays(TODAY, -3)), 1));
    expect(isDue(m, TODAY)).toBe(true);
  });

  it('a miss in the middle restarts the count; non-blind reps never count', () => {
    expect(deriveStep('a', blind(NOW, [['a', 2, 9, 85], ['a', 2, 10, 50], ['a', 2, 11, 90], ['a', 2, 12, 90]])).mastered_at).toBeNull();
    expect(deriveStep('a', blind(NOW, [['a', 2, 9, 90], ['a', 2, 10, 90], ['a', 2, 11, 90]], 'ghost')).mastered_at).toBeNull();
  });

  it('a clean review on the due day moves up a box and uses +3, then +7, then +14', () => {
    const base = [['a', 20, 9, 90], ['a', 20, 10, 90], ['a', 20, 11, 90]] as [string, number, number, number][];
    const reviews: [string, number, number, number][] = [['a', 19, 9, 90], ['a', 16, 9, 90], ['a', 9, 9, 90]];
    const m = deriveStep('a', blind(NOW, [...base, ...reviews]));
    expect(m.box).toBe(3);
    expect(m.reviewsPassed).toBe(3);
    expect(m.next_due).toBe(addDays(TODAY, 5));
  });

  it('a reps before the due day is only practice', () => {
    const m = deriveStep('a', blind(NOW, [['a', 5, 9, 90], ['a', 5, 10, 90], ['a', 5, 11, 90], ['a', 5, 12, 90]]));
    expect(m.reviewsPassed).toBe(0);
  });

  it('a failed review drops a box, asks again tomorrow and sends the step back to ghost', () => {
    const m = deriveStep('a', blind(NOW, [['a', 6, 9, 90], ['a', 6, 10, 90], ['a', 6, 11, 90], ['a', 5, 9, 90], ['a', 1, 9, 40]]));
    expect(m.box).toBe(0);
    expect(m.relearn).toBe(true);
    expect(m.next_due).toBe(TODAY);
    expect(startingPoint('blind', m, TODAY)).toEqual({ stage: 'blind', review: true });
    expect(startingPoint('blind', { ...m, next_due: addDays(TODAY, 2) }, TODAY)).toEqual({ stage: 'ghost', review: false });
  });
});

describe('guild rank', () => {
  const ids = ['s1', 's2'];
  const mastery = (id: string, day: number, hour: number): [string, number, number, number][] => [[id, day, hour, 85], [id, day, hour + 1, 88], [id, day, hour + 2, 91]];
  const test = (passed: boolean, daysAgo = 0): LoggedTest => ({ passed, overall: passed ? 88 : 50, at: blind(NOW, [['x', daysAgo, 15, 0]])[0].at as string });

  it('starts as an apprentice', () => {
    expect(deriveLesson(ids, []).rank).toBe('apprentice');
    expect(deriveLesson(ids, blind(NOW, mastery('s1', 3, 9))).rank).toBe('apprentice');
  });

  it('is a journeyman once every step is mastered blind in syllabus order', () => {
    const log = blind(NOW, [...mastery('s1', 3, 9), ...mastery('s2', 3, 12)]);
    const lp = deriveLesson(ids, log);
    expect(lp.rank).toBe('journeyman');
    expect(lp.blindScore).toBeGreaterThanOrEqual(80);
  });

  it('is not a journeyman if the steps were only passed blind in the wrong order', () => {
    const log = blind(NOW, [...mastery('s2', 3, 9), ...mastery('s1', 3, 12)]);
    expect(deriveLesson(ids, log).rank).toBe('apprentice');
  });

  it('needs a later-day review of every step and a passed duel for the seal', () => {
    const mastered = blind(NOW, [...mastery('s1', 5, 9), ...mastery('s2', 5, 12)]);
    const reviewed = [...mastered, ...blind(NOW, [['s1', 2, 9, 90], ['s2', 2, 10, 90]])];
    expect(deriveLesson(ids, reviewed, []).rank).toBe('journeyman');
    expect(deriveLesson(ids, reviewed, [test(false)]).rank).toBe('journeyman');
    const sealed = deriveLesson(ids, reviewed, [test(true, 1)]);
    expect(sealed.rank).toBe('sealed');
    expect(sealed.sealedAt).not.toBeNull();
    expect(sealed.testPassed).toBe(true);
    const half = [...mastered, ...blind(NOW, [['s1', 2, 9, 90]])];
    expect(deriveLesson(ids, half, [test(true)]).rank).toBe('journeyman');
  });

  it('seeded demo history gives one lesson due reviews and another the seal', () => {
    const lessons = [
      { id: 'l1', steps: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
      { id: 'l2', steps: [{ id: 'x' }, { id: 'y' }] },
    ];
    const h = buildDemoHistory(lessons, NOW);
    const first = deriveLesson(['a', 'b', 'c'], h.attempts.l1, h.tests.l1 ?? []);
    expect(first.rank).toBe('apprentice');
    expect(first.steps.filter((s) => isDue(s, TODAY)).length).toBeGreaterThanOrEqual(2);
    expect(deriveLesson(['x', 'y'], h.attempts.l2, h.tests.l2 ?? [], DEMO_CONFIG).rank).toBe('sealed');
  });
});

describe('daily practice mark', () => {
  it('marks the week from Monday and forgives rest days', () => {
    const marks = weekMarks([addDays(TODAY, -1), TODAY], TODAY);
    expect(marks).toHaveLength(7);
    expect(marks.filter((m) => m.practised)).toHaveLength(2);
    expect(marks.find((m) => m.today)?.practised).toBe(true);
    const s = weekSummary(marks, 3);
    expect(s.met).toBe(false);
    expect(s.line).toMatch(/rest day is free/);
    expect(weekSummary(marks, 2).met).toBe(true);
  });
});

describe('coach lines', () => {
  it('passes the scorer hint through intact, apostrophes included', () => {
    const hint = "Your finger shapes are right, but you are about 481 ms early. Match the guide hand's beat.";
    const score = { ...syntheticScore(85), hint };
    expect(repLine(score)).toBe(hint);
  });

  it('keeps the set line short', () => {
    const line = setLine([syntheticScore(60), syntheticScore(72)]);
    expect(line.split(/\s+/).length).toBeLessThanOrEqual(25);
    expect(setLine([])).toBe('');
  });
});

describe('duel bot scaled to rank', () => {
  it('keeps the original difficulty by default', () => {
    expect(botGoodChance(0)).toBeCloseTo(0.8, 6);
    expect(botGoodChance(100)).toBeCloseTo(0.45, 6);
  });

  it('plays better at higher ranks', () => {
    expect(botGoodChance(5, BOT_SKILL.sealed)).toBeGreaterThan(botGoodChance(5, BOT_SKILL.journeyman));
    expect(botGoodChance(5, BOT_SKILL.journeyman)).toBeGreaterThan(botGoodChance(5, BOT_SKILL.apprentice));
  });

  it('the piano bot scores higher at higher skill, and the default is unchanged', () => {
    const notes = schedulePhrase(DEFAULT_PHRASE, 1, DEFAULT_BEAT_S, 4);
    expect(botPerformance(notes, 7)).toEqual(botPerformance(notes, 7, 0.5));
    const low = botPerformance(notes, 7, BOT_SKILL.apprentice).overall;
    const high = botPerformance(notes, 7, BOT_SKILL.sealed).overall;
    expect(high).toBeGreaterThanOrEqual(low);
  });
});

describe('learner copy after the design review', () => {
  it('formats a review day as today, tomorrow or day and short month', async () => {
    const { formatDueDay, RANK_LABEL } = await import('../src/features/apprentice/pipeline/progress');
    expect(formatDueDay('2026-11-14', '2026-11-14')).toBe('today');
    expect(formatDueDay('2026-11-15', '2026-11-14')).toBe('tomorrow');
    expect(formatDueDay('2026-11-21', '2026-11-14')).toBe('21 Nov');
    expect(RANK_LABEL.sealed).toBe('Sealed');
  });

  it('never says "Follow the expert" twice: the strings blurb is one sentence', () => {
    expect(policyForStage('strings').blurb).toBe('Every finger is guided.');
    expect(policyForStage('strings').rehearsal).toBeUndefined();
  });
});
