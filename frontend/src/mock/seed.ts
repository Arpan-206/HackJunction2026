import type { Lesson, MoveKind } from '../api/types';
import movesJson from './data/moves.json';
import seedPiano from './data/seed-piano.json';
import seedTableTennis from './data/seed-table-tennis.json';

/** Move catalogue and seed lessons, copied verbatim from backend/app/data (refresh the copies if the backend ones change). */
export const MOVES = movesJson as unknown as MoveKind[];
export const SEED_LESSONS = [seedPiano, seedTableTennis] as unknown as Lesson[];
