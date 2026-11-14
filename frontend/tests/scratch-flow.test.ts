import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Lesson, TakesModel } from '../src/api/types';
import { choiceFromMove, freeChoice, LOCAL_MOVES } from '../src/features/master/lib';
import { folioLine, folioWhen, groupBySkill, sharedTitles, shelfOrder, skillKeyOf, skillWhen, SOURCE_LABEL } from '../src/features/master/home/shelf';
import { cameraFromPreset, EXPERT_STAGE_CAMERA, expertFrame, namedView, normaliseDeg, presetFromCamera } from '../src/features/master/components/cameraPresets';
import {
  clearDraft,
  consistencyHeadline,
  fingersSentence,
  FREE_INSTRUCTION,
  handsOptions,
  isEmptyDraft,
  lessonTitle,
  loadDraft,
  modelMatches,
  newDraft,
  newMove,
  reachableScreen,
  readModel,
  saveDraft,
  SCREENS,
  scratchLesson,
  skillFromSearch,
  stepFromModel,
  repOf,
  repStepId,
} from '../src/features/master/scratch/scratchDraft';

/** "Start from scratch" makes a new skill, step by step: the pure parts (draft, reading the takes model, the saved lesson). */

const forehand = choiceFromMove(LOCAL_MOVES.find((m) => m.id === 'tt_forehand_swing')!);

function model(over: Partial<TakesModel> = {}): TakesModel {
  const e = { thumb: 0, index: 0, middle: 0, ring: 0, little: 0 };
  return {
    side: 'right',
    reference_recording_id: 'b',
    take_ids: ['a', 'b', 'c'],
    tolerance: { angle_deg: 14, timing_ms: 250, finger_angle_deg: { thumb: 12, index: 10, middle: 14, ring: 22, little: 18 } },
    spread_deg: { thumb: 4.8, index: 4, middle: 5.6, ring: 8.8, little: 7.2 },
    takes: [
      { recording_id: 'a', is_reference: false, distance_deg: 3, score: 91.4, error_deg: e, worst_finger: 'ring', outlier: false },
      { recording_id: 'b', is_reference: true, distance_deg: 0, score: 100, error_deg: e, worst_finger: null, outlier: false },
      { recording_id: 'c', is_reference: false, distance_deg: 19, score: 48, error_deg: e, worst_finger: 'little', outlier: true },
    ],
    consistency: 69.7,
    steadiest_finger: 'index',
    loosest_finger: 'ring',
    enough_takes: true,
    warnings: ['Take 3 strays from the others.'],
    ...over,
  };
}

function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const area = (m: Map<string, string>) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) });
  vi.stubGlobal('window', { sessionStorage: area(store), localStorage: area(new Map<string, string>()) });
  return store;
}

describe('a new skill from scratch', () => {
  it('has no Choose screen: Record, Replay, Publish', () => {
    expect([...SCREENS]).toEqual(['record', 'replay', 'publish']);
    expect(newDraft().screen).toBe('record');
  });

  it('starts on a free move with a stable id, named Move 1 until Publish', () => {
    const d = newDraft('left');
    expect(d.current.moveId).toBeNull();
    expect(d.current.id).toMatch(/^free_[a-z0-9]{8}$/);
    expect(d.current.name).toBe('Move 1');
    expect(d.current.hands).toBe('left');
    expect(d.current.skill).toBe('general');
    expect(newMove(2).name).toBe('Move 2');
    expect(newMove(2).id).not.toBe(newMove(2).id);
  });

  it('labels takes by the move id, so renaming at Publish leaves the labels alone', () => {
    const m = newMove(1);
    const label = repStepId(m.id, 2);
    const renamed = { ...m, name: 'Centring the clay' };
    expect(repStepId(renamed.id, 2)).toBe(label);
    // The training-data pipeline parses it with rsplit(":rep", 1).
    const at = label.lastIndexOf(':rep');
    expect(label.slice(0, at)).toBe(m.id);
    expect(repOf(label)).toBe(2);
  });

  it('asks right, left or both for a free move, and only right or left for a one-handed catalogue move', () => {
    expect(handsOptions(newMove(1))).toEqual(['right', 'left', 'both']);
    expect(handsOptions(forehand)).toEqual(['right', 'left']);
    expect(handsOptions({ moveId: 'sp_snail', hands: 'both' })).toEqual([]);
    expect(handsOptions(freeChoice('Topspin loop', 'table_tennis'))).toEqual(['right', 'left', 'both']);
  });
});

describe('the draft', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('only opens a screen it can show', () => {
    const d = newDraft();
    expect(reachableScreen({ ...d, screen: 'record' })).toBe('record');
    expect(reachableScreen({ ...d, screen: 'replay' })).toBe('record');
    expect(reachableScreen({ ...d, screen: 'publish' })).toBe('record');
    expect(reachableScreen({ ...d, model: model(), screen: 'publish' })).toBe('publish');
    // After "Add another move", the earlier moves can still be published before the new one has its takes.
    const earlier = [{ choice: newMove(1), model: model() }];
    expect(reachableScreen({ ...d, moves: earlier, screen: 'publish' })).toBe('publish');
    expect(reachableScreen({ ...d, moves: earlier, screen: 'replay' })).toBe('record');
  });

  it('labels each take with the training-data convention <move_id>:rep<n>, and reads the number back', () => {
    expect(repStepId('tt_forehand_swing', 2)).toBe('tt_forehand_swing:rep2');
    expect(repOf('tt_forehand_swing:rep2')).toBe(2);
    expect(repOf('free_topspin_loop:rep12')).toBe(12);
    expect(repOf('s_1234')).toBe(0);
    expect(repOf(null)).toBe(0);
  });

  it('survives a reload in localStorage and is cleared after publishing', () => {
    stubStorage();
    const d = newDraft();
    const saved = { ...d, takeIds: { [d.current.id]: ['a', 'b'] } };
    expect(saveDraft(saved, 1000)).toEqual({ ...saved, savedAt: 1000 });
    expect(loadDraft()).toEqual({ ...saved, savedAt: 1000 });
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it('drops a draft of the old flow (with a Choose screen) instead of opening it', () => {
    const store = stubStorage();
    store.set('apprentice.scratch.draft.v1', JSON.stringify({ v: 1, id: 'x', screen: 'choose', skill: 'piano', current: null, model: null, takeIds: {}, moves: [], title: null, masterName: '' }));
    expect(loadDraft()).toBeNull();
    expect(store.has('apprentice.scratch.draft.v1')).toBe(false);
    // An old-shaped draft under the new key is refused too.
    store.set('apprentice.scratch.draft.v2', JSON.stringify({ v: 1, id: 'x', screen: 'choose' }));
    expect(loadDraft()).toBeNull();
  });

  it('works without storage', () => {
    expect(loadDraft()).toBeNull();
    expect(() => saveDraft(newDraft())).not.toThrow();
  });

  it('a model belongs to exactly its takes, in order', () => {
    expect(modelMatches(model(), ['a', 'b', 'c'])).toBe(true);
    expect(modelMatches(model(), ['a', 'c', 'b'])).toBe(false);
    expect(modelMatches(model(), ['a', 'b'])).toBe(false);
    expect(modelMatches(null, [])).toBe(false);
  });
});

describe('the takes model in plain words', () => {
  it('names the reference by take number, words each take, and flags the outlier', () => {
    const r = readModel(model(), ['a', 'b', 'c']);
    expect(r.referenceN).toBe(2);
    expect(r.takes.map((t) => t.word)).toEqual(['close', 'reference', 'strays']);
    expect(r.outliers.map((t) => t.n)).toEqual([3]);
    expect(r.headline).toBe('Some variation between takes, so the apprentice gets a little more room.');
  });

  it('reads consistency in four plain bands', () => {
    expect(consistencyHeadline(92)).toMatch(/^Very consistent/);
    expect(consistencyHeadline(75)).toMatch(/^Consistent/);
    expect(consistencyHeadline(60)).toMatch(/^Some variation/);
    expect(consistencyHeadline(30)).toMatch(/Another take or two/);
  });

  it('says which finger is judged strictly and which gets room', () => {
    expect(fingersSentence(model())).toBe('Your index finger was steadiest, so it will be judged strictly; your ring finger varied most and gets more room.');
    expect(fingersSentence(model({ steadiest_finger: 'thumb', loosest_finger: 'thumb' }))).toMatch(/thumb/);
  });
});

describe('publish', () => {
  it('saves the reference take, every take id and the per-finger tolerance on the step', () => {
    const step = stepFromModel(forehand, model());
    expect(step.reference_recording_id).toBe('b');
    expect(step.take_ids).toEqual(['a', 'b', 'c']);
    expect(step.tolerance).toEqual({ angle_deg: 14, timing_ms: 250, finger_angle_deg: { thumb: 12, index: 10, middle: 14, ring: 22, little: 18 } });
    expect(step.repetitions).toBe(3);
    expect(step.move_id).toBe('tt_forehand_swing');
    expect(step.hands).toBe('right');
  });

  it('publishes the named skill: its name is the title, each move a named step, takes untouched', () => {
    const m1 = { ...newMove(1), name: 'Centring' };
    const m2 = { ...newMove(2), name: '  ' };
    const lesson = scratchLesson({ skill: 'general', skillLocked: false, skillName: 'Pottery', about: '', masterName: ' Maestra Rossi ' }, [
      { choice: m1, model: model() },
      { choice: m2, model: model({ take_ids: ['d', 'e', 'f'], reference_recording_id: 'e' }) },
    ]);
    expect(lesson.title).toBe('Pottery');
    expect(lesson.skill).toBe('general');
    expect(lesson.source).toBe('scratch');
    expect(lesson.master_name).toBe('Maestra Rossi');
    expect(lesson.steps.map((s) => s.title)).toEqual(['Centring', 'Move 2']);
    expect(lesson.steps.map((s) => s.move_id)).toEqual([null, null]);
    expect(lesson.steps[1].take_ids).toEqual(['d', 'e', 'f']);
    expect(lesson.steps[0].instruction).toBe(FREE_INSTRUCTION);
    expect(lesson.summary).toBe('Recorded by hand: Centring, Move 2.');
  });

  it('falls back to "New skill", and uses the one line about it as summary and instruction of a single move', () => {
    const lesson = scratchLesson({ skill: 'general', skillLocked: false, skillName: null, about: ' Thumbs together, palms flat. ', masterName: '' }, [{ choice: newMove(1), model: model() }]);
    expect(lesson.title).toBe('New skill');
    expect(lesson.master_name).toBe('The expert');
    expect(lesson.summary).toBe('Thumbs together, palms flat.');
    expect(lesson.steps[0].instruction).toBe('Thumbs together, palms flat.');
    expect(lesson.steps[0].title).toBe('Move 1');
  });
});

describe('the expert shelf', () => {
  const step = {} as Lesson['steps'][number];
  const lesson = (over: Partial<Lesson>): Lesson => ({ id: 'l', title: 'T', skill: 'piano', summary: '', master_name: 'M', source: 'seed', steps: [], test: null, created_at: '2026-11-13T00:00:00+00:00', ...over });

  it('puts the newest lesson first, then orders same-day lessons by title', () => {
    const order = shelfOrder([
      lesson({ id: 'a', title: 'Piano: first fingering' }),
      lesson({ id: 'b', title: 'Pottery', created_at: '2026-11-14T09:00:00+00:00', source: 'scratch' }),
      lesson({ id: 'c', title: 'Finnish fingerspelling' }),
    ]).map((l) => l.id);
    expect(order).toEqual(['b', 'c', 'a']);
  });

  it('says the skill and the steps once, and where the lesson came from in plain words', () => {
    expect(folioLine(lesson({ title: 'Piano: first fingering', steps: [step, step] }))).toBe('2 steps');
    expect(folioLine(lesson({ title: 'Evening scales', steps: [step] }))).toBe('Piano, 1 step');
    expect(folioLine(lesson({ title: 'Pottery', skill: 'general', steps: [step] }))).toBe('1 step');
    expect(SOURCE_LABEL.generated).toBe('Drafted with the AI Assistant');
    expect(SOURCE_LABEL.scratch).toBe('Recorded from scratch');
  });

  it('dates a folio and counts practice only when there is some', () => {
    expect(folioWhen('2026-11-14T09:00:00+00:00', 0)).toBe('Added 14 Nov');
    expect(folioWhen('2026-11-14T09:00:00+00:00', 12)).toBe('Added 14 Nov, practised 12 times');
    expect(folioWhen('not a date', 1)).toBe('Practised 1 time');
  });
});

describe('the shelf groups lessons by skill', () => {
  const step = {} as Lesson['steps'][number];
  const lesson = (over: Partial<Lesson>): Lesson => ({ id: 'l', title: 'T', skill: 'table_tennis', summary: '', master_name: 'M', source: 'seed', steps: [step], test: null, created_at: '2026-11-13T00:00:00+00:00', ...over });
  const lessons = [
    lesson({ id: 'tt-seed', title: 'Table Tennis: grip and forehand' }),
    lesson({ id: 'tt-gen', title: 'Table Tennis: grip and forehand', source: 'generated', created_at: '2026-11-14T10:42:00+00:00', steps: [step, step] }),
    lesson({ id: 'tt-scr', title: 'Forehand basics', source: 'scratch', created_at: '2026-11-14T09:00:00+00:00' }),
    lesson({ id: 'piano', title: 'Piano: first fingering', skill: 'piano', created_at: '2026-11-12T00:00:00+00:00' }),
    lesson({ id: 'pot-1', title: 'Pottery', skill: 'general', source: 'scratch', created_at: '2026-11-14T08:00:00+00:00' }),
    lesson({ id: 'pot-2', title: ' pottery ', skill: 'general', source: 'scratch', created_at: '2026-11-14T11:00:00+00:00' }),
    lesson({ id: 'weave', title: 'Weaving', skill: 'general', source: 'scratch', created_at: '2026-11-10T00:00:00+00:00' }),
  ];

  it('makes one card per catalogue skill and one per skill made from scratch, grouped by its name', () => {
    const shelf = groupBySkill(lessons, { 'tt-seed': [1, 2], 'tt-gen': [1], piano: [1] });
    expect(shelf.map((s) => s.key)).toEqual(['own-pottery', 'table_tennis', 'piano', 'own-weaving']);
    const tt = shelf.find((s) => s.key === 'table_tennis')!;
    expect(tt.name).toBe('Table tennis');
    expect(tt.catalogue).toBe(true);
    expect(tt.lessons.map((l) => l.id)).toEqual(['tt-gen', 'tt-scr', 'tt-seed']);
    expect(tt.steps).toBe(4);
    expect(tt.practised).toBe(3);
    expect(tt.lastAdded).toBe('2026-11-14T10:42:00+00:00');
    const pottery = shelf[0];
    expect(pottery.lessons.map((l) => l.id)).toEqual(['pot-2', 'pot-1']);
    expect(pottery.catalogue).toBe(false);
    expect(pottery.skill).toBe('general');
    expect(skillKeyOf({ skill: 'general', title: 'Pottery: the wheel!' })).toBe('own-pottery-the-wheel');
    expect(skillKeyOf({ skill: 'piano', title: 'Anything' })).toBe('piano');
  });

  it('tells same-titled lessons apart by the hour they were added', () => {
    const twins = sharedTitles(lessons.filter((l) => l.skill === 'table_tennis'));
    expect([...twins].sort()).toEqual(['tt-gen', 'tt-seed']);
    expect(folioWhen('2026-11-14T10:42:00', 0, true)).toBe('Added 14 Nov, 10:42');
    expect(skillWhen('2026-11-14T10:42:00+00:00', 3)).toBe('Last added 14 Nov, practised 3 times');
  });
});

describe('a new lesson for an existing skill', () => {
  it('reads the skill from the skill page link: fixed for a catalogue skill, preset for one made from scratch', () => {
    expect(skillFromSearch('?skill=table_tennis')).toEqual({ skill: 'table_tennis', name: 'Table tennis', locked: true });
    expect(skillFromSearch('?skill=general&name=Pottery')).toEqual({ skill: 'general', name: 'Pottery', locked: false });
    expect(skillFromSearch('?skill=general')).toBeNull();
    expect(skillFromSearch('?skill=chess')).toBeNull();
    expect(skillFromSearch('')).toBeNull();
  });

  it('files the lesson under the catalogue skill and titles it after its moves', () => {
    const d = newDraft('right', { skill: 'piano', name: 'Piano', locked: true });
    expect(d.current.skill).toBe('piano');
    expect(isEmptyDraft(d)).toBe(true);
    const lesson = scratchLesson(d, [{ choice: { ...d.current, name: 'Thumb under' }, model: model() }]);
    expect(lesson.skill).toBe('piano');
    expect(lesson.title).toBe('Piano: Thumb under');
    expect(lessonTitle({ skillLocked: false, skillName: 'Pottery' }, ['Centring'])).toBe('Pottery');
    expect(isEmptyDraft({ ...d, takeIds: { [d.current.id]: ['a'] } })).toBe(false);
  });
});

describe('the expert stage camera', () => {
  it('opens on the role card view: 5.8 away, 20 degrees round, 55 up, mirrored for a left hand', () => {
    expect(EXPERT_STAGE_CAMERA.record).toEqual({ distance: 5.8, azimuthDeg: 20, elevationDeg: 55 });
    const right = expertFrame('record', ['right']);
    const left = expertFrame('record', ['left']);
    const r = cameraFromPreset(EXPERT_STAGE_CAMERA.record, right.target, right.mirror);
    const l = cameraFromPreset(EXPERT_STAGE_CAMERA.record, left.target, left.mirror);
    expect(l[0] - left.target[0]).toBeCloseTo(-(r[0] - right.target[0]), 6);
    expect(l[1]).toBeCloseTo(r[1], 6);
    expect(expertFrame('record', ['left', 'right']).key).toBe('recordBoth');
  });

  it('round-trips a copied camera: the preset puts the camera back where it was, after any amount of spinning', () => {
    for (const mirror of [1, -1] as const) {
      const target: [number, number, number] = [-0.35, -0.6, -1.06];
      for (const az of [20, -160, 179.5, 540 + 33]) {
        const pos = cameraFromPreset({ distance: 6.2, azimuthDeg: az, elevationDeg: 37 }, target, mirror);
        const p = presetFromCamera(pos, target, mirror);
        expect(p.azimuthDeg).toBeCloseTo(normaliseDeg(az), 2);
        expect(p.azimuthDeg).toBeGreaterThanOrEqual(-180);
        expect(p.azimuthDeg).toBeLessThanOrEqual(180);
        const back = cameraFromPreset(p, target, mirror);
        back.forEach((v, i) => expect(v).toBeCloseTo(pos[i], 2));
      }
    }
    expect(namedView('above', EXPERT_STAGE_CAMERA.record).elevationDeg).toBe(89);
    expect(namedView('side', EXPERT_STAGE_CAMERA.record).azimuthDeg).toBe(-90);
  });
});
