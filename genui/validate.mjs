// Validates a generated Apprentice page spec: JSON Schema first, then semantic rules the schema cannot express.
// Usage: node validate.mjs specs/piano.json [more.json ...]   Exit code 1 if any file is invalid.
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, 'catalog', 'page.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);

/** Returns a list of human-readable problems; empty means the spec is valid. */
export function validateSpec(spec) {
  const problems = [];
  if (!validateSchema(spec)) {
    for (const e of validateSchema.errors) {
      // anyOf failures are noisy; keep the specific leaf errors.
      if (e.keyword === 'anyOf') continue;
      problems.push(`schema ${e.instancePath || '/'}: ${e.message}`);
    }
    return problems;
  }
  const all = [...spec.main, ...spec.side];
  const stages = all.filter((c) => c.type === 'hand_stage');
  if (stages.length !== 1) problems.push(`rule: expected exactly 1 hand_stage, found ${stages.length}`);
  if (spec.main.filter((c) => c.type === 'hand_stage').length !== 1) problems.push('rule: the hand_stage must be in main');
  const stage = stages[0];
  if (stage) {
    const m = stage.motion;
    if (m.kind === 'finger_sequence' && !(m.sequence && m.sequence.length)) problems.push('rule: finger_sequence motion needs a sequence');
    if (m.kind === 'hold_pose' && !m.pose) problems.push('rule: hold_pose motion needs a pose');
    if (m.kind === 'grip_and_swing' && stage.prop === 'keyboard') problems.push('rule: grip_and_swing cannot use the keyboard prop');
    if (m.kind === 'finger_sequence' && stage.prop === 'racket') problems.push('rule: finger_sequence cannot use the racket prop');
  }
  const st = spec.header.stepper;
  if (st && st.current >= st.steps.length) problems.push(`rule: stepper.current ${st.current} is out of range for ${st.steps.length} steps`);
  if (spec.screen === 'duel' && !all.some((c) => c.type === 'scoreboard')) problems.push('rule: a duel screen needs a scoreboard');
  if (spec.screen === 'duel' && stage && stage.hands !== 'both') problems.push('rule: a duel screen shows both hands');
  if (all.filter((c) => c.type === 'action_bar').length > 1) problems.push('rule: at most one action_bar');
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let bad = 0;
  for (const file of process.argv.slice(2)) {
    let spec;
    try {
      spec = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      console.log(`FAIL ${file}\n  not JSON: ${err.message}`);
      bad++;
      continue;
    }
    const problems = validateSpec(spec);
    if (problems.length) {
      bad++;
      console.log(`FAIL ${file}`);
      problems.forEach((p) => console.log(`  ${p}`));
    } else {
      console.log(`PASS ${file} (${spec.main.length + spec.side.length} components)`);
    }
  }
  process.exit(bad ? 1 : 0);
}
