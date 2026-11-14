import type { FingerspellingPack, Lesson, MoveKind } from '../api/types';
import packsJson from './data/fingerspelling-packs.json';
import movesJson from './data/moves.json';
import seedPiano from './data/seed-piano.json';
import seedTableTennis from './data/seed-table-tennis.json';
import seedShadowPuppets from './data/seed-shadow-puppets.json';
import seedFinnishFingerspelling from './data/seed-finnish-fingerspelling.json';
import seedFingerspellingAM from './data/seed-fingerspelling-a-m.json';
import seedFingerspellingNZ from './data/seed-fingerspelling-n-z.json';
import seedFingerspellingWords from './data/seed-fingerspelling-words.json';

/** Move catalogue and seed lessons, copied verbatim from backend/app/data (refresh the copies if the backend ones change). */
export const MOVES = movesJson as unknown as MoveKind[];
export const SEED_LESSONS = [seedPiano, seedTableTennis, seedFinnishFingerspelling, seedShadowPuppets, seedFingerspellingAM, seedFingerspellingNZ, seedFingerspellingWords] as unknown as Lesson[];
/** Fingerspelling packs, copied verbatim from backend/app/data/fingerspelling_packs.json (the slot kit writes both). */
export const PACKS = (packsJson as unknown as { packs: FingerspellingPack[] }).packs;
