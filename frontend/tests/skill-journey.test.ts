import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Lesson } from '../src/api/types';
import type { LoggedAttempt } from '../src/features/shared/practiceLog';
import { skillProgress } from '../src/features/apprentice/skills/catalogue';
import { expertName, partStates, partsDone, partTo, skillJourney } from '../src/features/apprentice/skills/journeyMap';
import { syntheticScore } from '../src/features/apprentice/pipeline/progress';
import { askedStage, initialState, openAt } from '../src/features/apprentice/pipeline/stages';

// The clock is pinned to midday UTC. The attempts below reach five hours back, so a run between 00:00 and 05:00 UTC
// put them on the day before "today", and the mastered lesson was no longer done (CI on main failed at 00:16 UTC).
vi.useFakeTimers({ now: new Date('2026-11-14T12:00:00Z'), toFake: ['Date'] });
afterAll(() => {
  vi.useRealTimers();
});

const tol = { angle_deg: 18, timing_ms: 250 };
const step = (id: string) => ({ id, title: id, instruction: '', move_id: id, hands: 'right' as const, prop: 'none' as const, motion: null, reference_recording_id: null, repetitions: 3, tolerance: tol, video_url: null });
const course = (id: string, steps: string[], test = false): Lesson =>
  ({ id, title: id, skill: 'table_tennis', summary: '', master_name: 'Demo master', source: 'seed', created_at: '2026-11-13T00:00:00Z', steps: steps.map(step), ...(test ? { test: { kind: 'table_tennis_rally', opponent: 'bot', rounds: 3 } } : {}) }) as unknown as Lesson;

/** A fixed mid-afternoon, so attempts a few hours old stay on the same day however late the suite runs. */
const NOW = new Date(2026, 10, 14, 15, 0).getTime();
const rep = (step_id: string, stage: LoggedAttempt['stage'], v: number, minutesAgo: number): LoggedAttempt => ({ step_id, stage, kind: 'practice', score: syntheticScore(v), at: new Date(NOW - minutesAgo * 60000).toISOString() });

describe('the skill page timeline', () => {
  const courses = [course('c1', ['grip', 'swing', 'snap'], true), course('c2', ['serve'])];
  const attempts = {
    c1: [rep('grip', 'ghost', 85, 300), rep('grip', 'ghost', 88, 299), rep('grip', 'ghost', 90, 298), rep('grip', 'blind', 86, 290), rep('grip', 'blind', 90, 289), rep('grip', 'blind', 93, 288), rep('swing', 'ghost', 61, 200), rep('swing', 'ghost', 72, 199)],
  };
  const today = '2026-11-14';
  const progress = skillProgress(courses, attempts, today);
  const path = skillJourney({ courses, progress, attempts, tests: { c1: [{ passed: false, overall: 64.4, at: '2026-11-14T10:00:00Z' }] }, seen: (id) => new Set(id === 'c1' ? ['snap'] : []), played: () => null });

  it('lists every lesson of every course, each with its four parts and a link that opens it', () => {
    expect(path.map((c) => c.lessons.length)).toEqual([3, 1]);
    expect(path[0].lessons[0].parts.map((p) => p.key)).toEqual(['tutorial', 'watch', 'ghost', 'blind']);
    expect(path[0].lessons[1].to).toBe('/apprentice/lessons/c1/steps/1');
    expect(path[0].lessons[1].parts.map((p) => p.to)).toEqual([
      '/apprentice/lessons/c1/steps/1/tutorial',
      '/apprentice/lessons/c1/steps/1?stage=watch',
      '/apprentice/lessons/c1/steps/1?stage=ghost',
      '/apprentice/lessons/c1/steps/1?stage=blind',
    ]);
  });

  it('marks a mastered lesson done to the end, the current one where it stands, and an unpractised one ahead', () => {
    const [grip, swing, snap] = path[0].lessons;
    expect(grip.mastered).toBe(true);
    expect(grip.parts.every((p) => p.state === 'done')).toBe(true);
    expect(swing.here).toBe(true);
    expect(swing.best).toBe(72);
    expect(swing.attempts).toBe(2);
    expect(swing.parts.map((p) => p.state)).toEqual(['done', 'done', 'now', 'next']);
    // Its tutorial was watched, nothing practised yet.
    expect(snap.parts.map((p) => p.state)).toEqual(['done', 'now', 'next', 'next']);
    expect(path[0].mastered).toBe(1);
  });

  it('ends each course with its game or its Play round', () => {
    expect(path[0].finale).toEqual({ to: '/apprentice/lessons/c1/test', played: 1, best: 64 });
    expect(path[1].finale).toEqual({ to: '/apprentice/lessons/c2/play', played: 0, best: null });
  });

  it('a due review puts the learner back at Ghost off', () => {
    const done = partsDone({ seenTutorial: true, staged: [], mastered: true });
    expect(partStates(done, true).blind).toBe('now');
    expect(partStates(done, false).blind).toBe('done');
  });

  it('builds part routes', () => {
    expect(partTo('x', 2, 'tutorial')).toBe('/apprentice/lessons/x/steps/2/tutorial');
    expect(partTo('x', 2, 'ghost')).toBe('/apprentice/lessons/x/steps/2?stage=ghost');
  });

  it('shows an older "master" name as expert, and leaves real names alone', () => {
    expect(expertName('Demo master')).toBe('Demo expert');
    expect(expertName('Master Ting')).toBe('Expert Ting');
    expect(expertName('Mastery Guild')).toBe('Mastery Guild');
    expect(expertName('Ana')).toBe('Ana');
  });
});

describe('opening a lesson at a stage from a link', () => {
  it('reads only the three practice stages', () => {
    expect(askedStage('watch')).toBe('watch');
    expect(askedStage('blind')).toBe('blind');
    expect(askedStage('strings')).toBeNull();
    expect(askedStage(null)).toBeNull();
  });

  it('Watch brings the puppet back for a lesson resumed at Ghost off, keeping its mastery', () => {
    const resumed = { ...initialState('blind'), mastered: true, combo: 1 };
    const s = openAt(resumed, 'watch');
    expect(s.stage).toBe('watch');
    expect(s.mastered).toBe(true);
  });

  it('Ghost on and Ghost off flip the switch, even from a first visit', () => {
    expect(openAt(initialState('watch'), 'blind').stage).toBe('blind');
    expect(openAt(initialState('blind'), 'ghost').stage).toBe('ghost');
    const kept = initialState('ghost');
    expect(openAt(kept, null)).toBe(kept);
  });
});
