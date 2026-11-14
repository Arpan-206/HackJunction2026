import type { Lesson, Step } from '../../../api/types';
import seedShadowPuppets from '../../../mock/data/seed-shadow-puppets.json';
import seedFinnishFingerspelling from '../../../mock/data/seed-finnish-fingerspelling.json';

const tol = { angle_deg: 18, timing_ms: 250 };

function step(id: string, title: string, instruction: string, move_id: string, prop: Step['prop'], motion: Step['motion'], repetitions: number): Step {
  return { id, title, instruction, move_id, hands: 'right', prop, motion, reference_recording_id: null, repetitions, tolerance: tol, video_url: null };
}

/** Offline copies of the seed lessons, so the apprentice screens still work when the backend is down. */
export const LOCAL_LESSONS: Lesson[] = [
  {
    id: 'seed-table-tennis',
    title: 'Table Tennis: grip and forehand',
    skill: 'table_tennis',
    summary: 'Learn the shakehand grip, a clean forehand swing and the wrist snap at contact.',
    master_name: 'Demo expert',
    source: 'seed',
    created_at: '2026-11-13T00:00:00+00:00',
    test: { kind: 'table_tennis_rally', opponent: 'bot', rounds: 3 },
    steps: [
      step('seed-tt-grip', 'Lesson 1: The shakehand grip', 'Hold the racket like a handshake. Thumb and index finger rest on the rubber, the other three fingers wrap round the handle.', 'tt_shakehand_grip', 'racket', { preset: 'hold_pose', pose: { thumb: 0.62, index: 0.8, middle: 0.84, ring: 0.86, little: 0.88 } }, 3),
      step('seed-tt-forehand', 'Lesson 2: Forehand swing', 'Keep the grip steady, swing back, drive through the ball and follow through across your body.', 'tt_forehand_swing', 'racket', { preset: 'grip_and_swing', grip: 'shakehand', swing: 'forehand', beat_ms: 1500 }, 5),
      step('seed-tt-snap', 'Lesson 3: Wrist snap at contact', 'Stay relaxed until the ball arrives, then snap the wrist and squeeze the handle for a split second.', 'tt_wrist_snap', 'racket', { preset: 'grip_and_swing', grip: 'shakehand', swing: 'forehand', beat_ms: 900 }, 5),
    ],
  },
  {
    id: 'seed-piano',
    title: 'Piano: first fingering',
    skill: 'piano',
    summary: 'Set your hand position and play a five-finger scale up and back down.',
    master_name: 'Demo expert',
    source: 'seed',
    created_at: '2026-11-13T00:00:00+00:00',
    test: { kind: 'piano_play_along', opponent: 'bot', rounds: 3 },
    steps: [
      step('seed-piano-position', 'Lesson 1: Hand position', 'Rest your fingers on five neighbouring keys, curved like you are holding a small ball, wrist level.', 'piano_chord_c_major', 'keyboard', { preset: 'hold_pose', pose: { thumb: 0.2, index: 0.2, middle: 0.2, ring: 0.2, little: 0.2 } }, 3),
      step('seed-piano-scale', 'Lesson 2: Five-finger scale', 'Press each key in turn with fingers 1 2 3 4 5, then back down 4 3 2 1, at an even pace.', 'piano_five_finger_scale', 'keyboard', { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5, 4, 3, 2, 1], beat_ms: 620 }, 3),
    ],
  },
  ...([seedFinnishFingerspelling, seedShadowPuppets] as unknown as Lesson[]),
];
