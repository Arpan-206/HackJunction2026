import { describe, expect, it } from 'vitest';
import type { Lesson, Skill, Step } from '../src/api/types';
import type { LoggedAttempt } from '../src/features/shared/practiceLog';
import { LOCAL_LESSONS } from '../src/features/apprentice/hooks/localLessons';
import {
  buildSkills,
  CATALOGUE,
  filterSkills,
  matchesQuery,
  matchReason,
  NO_FILTER,
  skillNameFromId,
  skillProgress,
  type SkillView,
} from '../src/features/apprentice/skills/catalogue';
import { syntheticScore } from '../src/features/apprentice/pipeline/progress';
import { DEFAULT_CONFIG } from '../src/features/apprentice/pipeline/stages';

function step(id: string, title: string, hands: Step['hands'] = 'right'): Step {
  return {
    id, title, instruction: '', move_id: null, hands, prop: 'none', motion: { preset: 'hold_pose', pose: { thumb: 0.5 } },
    reference_recording_id: null, repetitions: 3, tolerance: { angle_deg: 18, timing_ms: 250 }, video_url: null,
  };
}

function lesson(id: string, skill: string, title: string, steps: Step[], created_at = '2026-11-14T00:00:00Z', source: Lesson['source'] = 'scratch'): Lesson {
  return { id, title, skill: skill as Skill, summary: `${title} summary`, master_name: 'Ada', source, steps, test: null, created_at };
}

const byId = (skills: SkillView[], id: string) => skills.find((s) => s.id === id) as SkillView;

describe('buildSkills: catalogue merged with lessons', () => {
  it('lists exactly the four demo skills, all live from the seed lessons', () => {
    const skills = buildSkills(LOCAL_LESSONS);
    expect(CATALOGUE.map((c) => c.id)).toEqual(['table_tennis', 'piano', 'fingerspelling', 'shadow_puppets']);
    expect(skills.filter((s) => s.live).map((s) => s.id)).toEqual(['table_tennis', 'piano', 'fingerspelling', 'shadow_puppets']);
    expect(skills.filter((s) => !s.live).map((s) => s.id)).toEqual([]);
    expect(byId(skills, 'table_tennis').lessonCount).toBe(3);
    expect(byId(skills, 'piano').courses.map((c) => c.id)).toEqual(['seed-piano']);
  });

  it('keeps every catalogue skill in the workshop, in catalogue order, while there are no lessons', () => {
    const skills = buildSkills([]);
    expect(skills.map((s) => [s.id, s.live])).toEqual([
      ['table_tennis', false], ['piano', false], ['fingerspelling', false], ['shadow_puppets', false],
    ]);
    expect(byId(skills, 'piano').courses).toEqual([]);
  });

  it('groups several courses under one skill, seed first, and keeps only the newest course per title', () => {
    const older = lesson('a', 'table_tennis', 'Backhand', [step('a1', 'Lesson 1: Push')], '2026-11-01T00:00:00Z');
    const newer = lesson('b', 'table_tennis', 'backhand ', [step('b1', 'Lesson 1: Push'), step('b2', 'Lesson 2: Flick')], '2026-11-10T00:00:00Z');
    const tt = byId(buildSkills([older, ...LOCAL_LESSONS, newer]), 'table_tennis');
    expect(tt.courses.map((c) => c.id)).toEqual(['seed-table-tennis', 'b']);
    expect(tt.lessonCount).toBe(5);
  });

  it('shows a lesson for an unknown skill id as a live skill with defaults, after the known live skills', () => {
    const extra = lesson('x', 'calligraphy_quill', 'Quill grip', [step('x1', 'Hold the quill', 'both')]);
    const skills = buildSkills([...LOCAL_LESSONS, extra]);
    const q = byId(skills, 'calligraphy_quill');
    expect(q).toMatchObject({ live: true, name: 'Calligraphy quill', difficulty: 'beginner', hands: 'two', description: 'Quill grip summary', lessonCount: 1 });
    expect(q.timeToLearn).toMatch(/1 day/);
    expect(skills.map((s) => s.id).indexOf('calligraphy_quill')).toBe(4);
  });

  it('turns a workshop skill live when an expert records a lesson for it, and ignores empty courses', () => {
    const shadows = lesson('s', 'shadow_puppets', 'The dog', [step('s1', 'Lesson 1: The dog')]);
    const empty = lesson('e', 'piano', 'Nothing yet', []);
    const skills = buildSkills([shadows, empty]);
    expect(byId(skills, 'shadow_puppets').live).toBe(true);
    expect(byId(skills, 'shadow_puppets').name).toBe('Shadow puppets');
    expect(byId(skills, 'piano').live).toBe(false);
    expect(skills[0].id).toBe('shadow_puppets');
  });

  it('names skill ids readably', () => {
    expect(skillNameFromId('rock_paper-scissors')).toBe('Rock paper scissors');
    expect(skillNameFromId('')).toBe('Untitled skill');
  });

  it('keeps one catalogue entry per id, each with keywords and a time to learn', () => {
    expect(new Set(CATALOGUE.map((c) => c.id)).size).toBe(CATALOGUE.length);
    for (const c of CATALOGUE) {
      expect(c.keywords.length).toBeGreaterThan(0);
      expect(c.timeToLearn).not.toBe('');
    }
  });
});

describe('the propless seeded skills: shadow puppets and fingerspelling', () => {
  const skills = buildSkills(LOCAL_LESSONS);

  it('shadow puppets: a live beginner skill for two hands, five named animals, a picture for its card', () => {
    const sp = byId(skills, 'shadow_puppets');
    expect(sp).toMatchObject({ live: true, name: 'Shadow puppets', difficulty: 'beginner', hands: 'two', lessonCount: 5 });
    expect(sp.still?.src).toBe('/stills/shadow-puppets.jpg');
    expect(sp.wouldTeach).toBeUndefined();
    expect(sp.courses[0].steps.map((s) => s.title.replace(/^Lesson \d+: /, ''))).toEqual(['The rabbit', 'The talking dog', 'The swan', 'The flapping bird', 'The snail']);
    expect(sp.courses[0].steps.filter((s) => s.hands === 'both').map((s) => s.move_id)).toEqual(['sp_flapping_bird', 'sp_snail']);
  });

  it('Fingerspelling: a live one-handed skill with only the spell a word course, two lessons', () => {
    const fs = byId(skills, 'fingerspelling');
    expect(fs).toMatchObject({ live: true, name: 'Fingerspelling', difficulty: 'intermediate', hands: 'one', lessonCount: 2 });
    expect(fs.courses.map((c) => c.id)).toEqual(['seed-fingerspelling-words']);
    expect(fs.courses[0].steps.map((s) => s.title.replace(/^Lesson \d+: /, ''))).toEqual(['Spell JUNCTION', 'Spell GEPPETTO']);
    expect(fs.courses[0].steps.every((s) => s.hands === 'right')).toBe(true);
    expect(fs.wouldTeach).toHaveLength(2);
  });

  it('the Finnish skill and the alphabet courses are gone from the dashboard', () => {
    expect(skills.map((s) => s.id)).not.toContain('finnish_fingerspelling');
    const courseIds = skills.flatMap((s) => s.courses.map((c) => c.id));
    expect(courseIds).not.toContain('seed-fingerspelling-a-m');
    expect(courseIds).not.toContain('seed-fingerspelling-n-z');
    expect(courseIds).not.toContain('seed-finnish-fingerspelling');
    const copy = JSON.stringify(skills.map((s) => [s.name, s.description, s.keywords]));
    expect(copy).not.toMatch(/finnish|suomi|viittomakieli/i);
  });

  it('needs no prop for any of their lessons', () => {
    for (const id of ['shadow_puppets', 'fingerspelling']) {
      for (const c of byId(skills, id).courses) expect(c.steps.every((s) => s.prop === 'none')).toBe(true);
    }
  });

  it('is found by its animals, letters and words', () => {
    const find = (q: string) => filterSkills(skills, { ...NO_FILTER, query: q }).map((s) => s.id);
    expect(find('rabbit')).toEqual(['shadow_puppets']);
    expect(find('junction')).toEqual(['fingerspelling']);
    expect(find('geppetto')).toEqual(['fingerspelling']);
    expect(find('sign lang')).toEqual(['fingerspelling']);
    expect(find('suomi')).toEqual([]);
  });
});

describe('filterSkills: search and toggles', () => {
  const skills = buildSkills(LOCAL_LESSONS);
  const ids = (f: Partial<typeof NO_FILTER>) => filterSkills(skills, { ...NO_FILTER, ...f }).map((s) => s.id);

  it('returns everything for an empty or blank query', () => {
    expect(ids({ query: '   ' })).toHaveLength(skills.length);
  });

  it('matches on name, description and keywords, ignoring case and punctuation', () => {
    expect(ids({ query: 'music' })).toEqual(['piano']);
    expect(ids({ query: 'SIGN' })).toEqual(['fingerspelling']);
    expect(ids({ query: 'grip' })).toEqual(['table_tennis']);
    expect(ids({ query: 'candlelight' })).toEqual(['shadow_puppets']);
    expect(ids({ query: 'ping-pong' })).toEqual(['table_tennis']);
  });

  it('needs every word of the query to appear', () => {
    expect(ids({ query: 'sign language' })).toEqual(['fingerspelling']);
    expect(ids({ query: 'music sign' })).toEqual([]);
  });

  it('also finds a live skill by its lesson titles', () => {
    expect(ids({ query: 'five-finger scale' })).toEqual(['piano']);
  });

  it('filters by difficulty and by hands, combined with the query', () => {
    expect(ids({ difficulty: 'advanced' })).toEqual([]);
    expect(ids({ difficulty: 'intermediate' })).toEqual(['table_tennis', 'fingerspelling']);
    expect(ids({ hands: 'two' })).toEqual(['shadow_puppets']);
    expect(ids({ hands: 'one' })).toEqual(['table_tennis', 'piano', 'fingerspelling']);
    expect(ids({ query: 'music', difficulty: 'beginner' })).toEqual(['piano']);
    expect(ids({ query: 'xyz' })).toEqual([]);
  });

  it('matchesQuery is true for an empty query', () => {
    expect(matchesQuery(skills[0], '')).toBe(true);
  });
});

describe('matchReason', () => {
  const skills = buildSkills(LOCAL_LESSONS);
  it('quotes the lesson title that holds the word, with the whole word marked', () => {
    expect(matchReason(byId(skills, 'table_tennis'), 'gri')).toEqual({ before: 'The shakehand ', match: 'grip', after: '' });
  });
  it('falls back to a keyword, and says nothing when the name already matches or the query is empty', () => {
    expect(matchReason(byId(skills, 'fingerspelling'), 'deaf')?.match).toBe('deaf');
    expect(matchReason(byId(skills, 'piano'), 'piano')).toBeNull();
    expect(matchReason(byId(skills, 'piano'), '')).toBeNull();
  });
});

describe('skillProgress', () => {
  const tt = byId(buildSkills(LOCAL_LESSONS), 'table_tennis');
  const today = '2026-11-14';
  const blind = (stepId: string, overall: number, at: string): LoggedAttempt => ({ step_id: stepId, score: syntheticScore(overall), stage: 'blind', at });

  it('starts at lesson 1 with nothing practised', () => {
    const p = skillProgress(tt.courses, {}, today);
    expect(p).toMatchObject({ total: 3, mastered: 0, started: false, next: { courseId: 'seed-table-tennis', index: 0, kind: 'start' } });
  });

  it('continues at the first lesson not mastered once the first is mastered blind', () => {
    const log = { 'seed-table-tennis': [1, 2, 3].map((i) => blind('seed-tt-grip', 92, `2026-11-14T10:0${i}:00Z`)) };
    const p = skillProgress(tt.courses, log, today, DEFAULT_CONFIG);
    expect(p.mastered).toBe(1);
    expect(p.next).toEqual({ courseId: 'seed-table-tennis', index: 1, kind: 'continue' });
    expect(p.lessons[0][0]).toMatchObject({ mastered: true, attempts: 3, best: 92, due: false });
  });
});
