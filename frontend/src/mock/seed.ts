import type { Lesson, MoveKind } from '../api/types';
import movesJson from './data/moves.json';
import seedPiano from './data/seed-piano.json';
import seedTableTennis from './data/seed-table-tennis.json';
import seedShadowPuppets from './data/seed-shadow-puppets.json';
import seedSurgicalGrips from './data/seed-surgical-grips.json';
import seedSurgicalTies from './data/seed-surgical-ties.json';
import seedCrochet from './data/seed-crochet.json';

/** Move catalogue and seed lessons, copied verbatim from backend/app/data (refresh the copies if the backend ones change). */
export const MOVES = movesJson as unknown as MoveKind[];
export const SEED_LESSONS = [seedPiano, seedTableTennis, seedShadowPuppets, seedSurgicalGrips, seedSurgicalTies, seedCrochet] as unknown as Lesson[];
