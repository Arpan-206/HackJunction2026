#!/usr/bin/env node
/**
 * Writes frontend/tour/reviews.json (committed): real lines the tuned feedback model (job B, feedback after a
 * repetition) wrote during its held-out test, with the input each one was given. Run once, locally, where the
 * git-ignored coach_tune/out exists:
 *
 *   node scripts/tour/build-reviews.mjs <path to coach_tune/out>
 *
 * The chosen test ids are listed below, so the choice is reviewable. Two come from real capture frames, three from
 * synthetic test rows; every one passed the checks (`ok`) and is in English.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHOSEN = ['ct-00011', 'ct-00034', 'ct-00127', 'ct-00173', 'ct-00251'];

const coachDir = process.argv[2];
if (!coachDir) {
  console.error('usage: node scripts/tour/build-reviews.mjs <coach_tune/out dir>');
  process.exit(2);
}
const lines = (p) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const test = new Map(lines(join(coachDir, 'dataset', 'test.jsonl')).map((t) => [t.id, t]));
const tuned = new Map(lines(join(coachDir, 'review', 'eval', 'tuned.jsonl')).map((o) => [o.id, o]));
const reviews = CHOSEN.map((id) => {
  const t = test.get(id);
  const r = tuned.get(id);
  if (!t || !r || !r.ok || t.lang !== 'en') throw new Error(`${id}: missing, not ok or not English`);
  return { source: t.source, task: t.task, step: t.step_name, finger: t.top_finger, error: t.top_hint, score: t.score, line: r.line };
});
const out = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../tour/reviews.json');
writeFileSync(out, `${JSON.stringify({ reviews }, null, 1)}\n`);
console.log(`reviews: ${reviews.length}`);
