import { describe, expect, it } from 'vitest';
import type { Lesson } from '../src/api/types';
import { actionLabel, isBehind, nodeState, stopDetail, stopsOf, type Stop } from '../src/features/apprentice/skills/SkillTrail';
import type { PathCourse, PathLesson } from '../src/features/apprentice/skills/journeyMap';

const lesson = (o: Partial<PathLesson> = {}): PathLesson => ({ index: 1, here: false, mastered: false, due: false, attempts: 0, best: null, ...o }) as unknown as PathLesson;
const stop = (l: Partial<PathLesson>, test = false): Stop =>
  ({ kind: 'lesson', key: 'c:1', course: { test: test ? {} : undefined } as unknown as Lesson, lesson: lesson(l) }) as unknown as Stop;
const finale = (best: number | null, played: number, test: boolean, mastered = 0, total = 2): Stop =>
  ({ kind: 'finale', key: 'c:finale', course: (test ? { test: {} } : {}) as unknown as Lesson, path: { mastered, lessons: new Array(total) }, finale: { best, played } }) as unknown as Stop;

describe('SkillTrail actionLabel', () => {
  it('reviews the here lesson when the next step is a review', () => {
    expect(actionLabel(stop({ here: true }), { kind: 'review' } as never)).toBe('Review lesson 2');
  });
  it('says Practise again for a mastered lesson not due, Review when due', () => {
    expect(actionLabel(stop({ mastered: true }), null)).toBe('Practise lesson 2 again');
    expect(actionLabel(stop({ mastered: true, due: true }), null)).toBe('Review lesson 2');
  });
  it('continues after attempts and starts otherwise', () => {
    expect(actionLabel(stop({ attempts: 2, best: 70 }), null)).toBe('Continue lesson 2');
    expect(actionLabel(stop({}), null)).toBe('Start lesson 2');
    expect(actionLabel(stop({ here: true }), { kind: 'start' } as never)).toBe('Start lesson 2');
    expect(actionLabel(stop({ here: true }), { kind: 'continue' } as never)).toBe('Continue lesson 2');
  });
  it('labels the finale by whether the course has a test', () => {
    expect(actionLabel(finale(null, 0, true), null)).toBe('Test your skills');
    expect(actionLabel(finale(null, 0, false), null)).toBe('Play a round');
  });
});

describe('SkillTrail node text', () => {
  it('describes node states', () => {
    expect(nodeState(stop({ here: true }))).toBe('You are here');
    expect(nodeState(stop({ mastered: true, due: true }))).toBe('Review due');
    expect(nodeState(stop({ mastered: true }))).toBe('Mastered');
    expect(nodeState(stop({ attempts: 1, best: 55 }))).toBe('Best 55');
    expect(nodeState(stop({}))).toBe('Not started');
    expect(nodeState(finale(80, 1, true))).toBe('Best 80');
    expect(nodeState(finale(null, 0, true))).toBe('Not played');
  });
  it('describes details with correct plurals', () => {
    expect(stopDetail(stop({ attempts: 1, best: 55 }))).toBe('Best 55 in 1 attempt.');
    expect(stopDetail(stop({ attempts: 3, best: 55 }))).toBe('Best 55 in 3 attempts.');
    expect(stopDetail(stop({}))).toBe('Not started yet.');
    expect(stopDetail(stop({ mastered: true, due: true, best: 90 }))).toBe('Mastered, best 90. Review due today.');
    expect(stopDetail(finale(80, 1, true))).toBe('Best 80 in 1 game.');
    expect(stopDetail(finale(80, 2, false))).toBe('Best 80 in 2 rounds.');
    expect(stopDetail(finale(null, 0, true, 1, 2))).toBe('Open now, and best played after the lessons.');
    expect(stopDetail(finale(null, 0, true, 2, 2))).toBe('Every lesson mastered: time to play.');
  });
  it('inks the line behind mastered lessons and played games only', () => {
    expect(isBehind(stop({ mastered: true }))).toBe(true);
    expect(isBehind(stop({ attempts: 2 }))).toBe(false);
    expect(isBehind(finale(70, 1, true))).toBe(true);
    expect(isBehind(finale(null, 0, true))).toBe(false);
  });
  it('flattens courses into lessons plus one finale each', () => {
    const c = (id: string, n: number) => ({ id, steps: Array.from({ length: n }, (_, i) => ({ title: `s${i}` })) }) as unknown as Lesson;
    const p = (n: number) => ({ lessons: Array.from({ length: n }, (_, i) => lesson({ index: i })), finale: { best: null, played: 0 } }) as unknown as PathCourse;
    const s = stopsOf([c('a', 2), c('b', 1)], [p(2), p(1)]);
    expect(s.map((x) => x.key)).toEqual(['a:0', 'a:1', 'a:finale', 'b:0', 'b:finale']);
  });
});
