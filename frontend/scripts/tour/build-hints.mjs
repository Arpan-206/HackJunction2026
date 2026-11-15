#!/usr/bin/env node
/**
 * Writes frontend/tour/hints.json (committed): a handful of real lines the tuned hint model wrote during its held-out
 * test, with the input each one was given. Run once, locally, where the git-ignored coach_tune/out exists:
 *
 *   node scripts/tour/build-hints.mjs <path to coach_tune/out>
 *
 * Only synthetic test attempts are used, so no glove capture of any wearer is involved.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const coachDir = process.argv[2];
if (!coachDir) {
  console.error('usage: node scripts/tour/build-hints.mjs <coach_tune/out dir>');
  process.exit(2);
}
const lines = (p) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const test = lines(join(coachDir, 'dataset', 'test.jsonl'));
const tuned = new Map(lines(join(coachDir, 'eval', 'tuned.jsonl')).map((o) => [o.id, o]));

const picked = [];
const seen = new Set();
for (const lang of ['en', 'en', 'en', 'fi', 'de', 'en']) {
  // Letter and puppet units only (not the internal demo set); vary the unit and the kind of error.
  const ok = (t) => t.source === 'synthetic' && t.unit !== 'fake-demo' && t.lang === lang && tuned.get(t.id)?.ok;
  const row = test.find((t) => ok(t) && !seen.has(t.unit) && !seen.has(t.top_hint)) ?? test.find((t) => ok(t) && !seen.has(t.top_hint)) ?? test.find((t) => ok(t) && !seen.has(t.id));
  if (!row) continue;
  seen.add(row.unit);
  seen.add(row.top_hint);
  seen.add(row.id);
  picked.push({ lang: row.lang, task: row.task, step: row.step_name, finger: row.top_finger, error: row.top_hint, score: row.score, line: tuned.get(row.id).line });
}
const out = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../tour/hints.json');
writeFileSync(out, `${JSON.stringify({ hints: picked }, null, 1)}\n`);
console.log(`hints: ${picked.length}`);
