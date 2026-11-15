// Walks the expert's "Start from scratch" flow for a new skill in mock mode (no Python backend): the studio's two doors and
// the shelf of lesson folios, then Record opens straight away (no catalogue), answers the hands question, records three
// takes (the mock simulator plays whatever it plays), reads the takes model, reloads and finds the takes again, deletes and
// redoes one, Replays the reference take in the Strings and Ghost views, and on Publish names the skill and the move, tries
// "Add another move" and comes back, publishes and lands on the lesson page. Then checks the saved step carries the move's
// name, the reference take, every take id labelled `<free move id>:rep<n>` and the per-finger tolerance, and that the new
// skill sits first on the shelf.
// Runs once at 1536x760 and once at 390 wide, plus the studio in the Notte theme. Fails on any console or page error.
// Screenshots: <prefix>-<n>-<screen>[-390|-notte].png in E2E_SHOTS (default docs/screens/expert-flow), prefix E2E_PREFIX
// (default expert-flow).
// Run: node e2e/expert-flow-walk.mjs   (E2E_PORT picks the port; starts Vite on :5182 if nothing answers there).
// E2E_REAL=1 walks the real backend instead (?mock=0; start it with GLOVE_SOURCE=simulator and LLM_PROVIDER=fake), desktop
// width only; it prints the published lesson id, and deletes the takes it recorded once it is done.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, '../../genui/node_modules/playwright'));

const PORT = Number(process.env.E2E_PORT ?? 5182);
const BASE = `http://localhost:${PORT}`;
const REAL = process.env.E2E_REAL === '1';
const OUT = path.resolve(process.env.E2E_SHOTS ?? path.resolve(here, '../docs/screens/expert-flow'));
mkdirSync(OUT, { recursive: true });
const PREFIX = process.env.E2E_PREFIX ?? 'expert-flow';

async function up(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

let vite = null;
if (!(await up(BASE))) {
  const bin = path.resolve(here, '../node_modules/vite/bin/vite.js');
  vite = spawn(process.execPath, [bin, '--port', String(PORT), '--strictPort'], { cwd: path.resolve(here, '..'), stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up(BASE)); i++) await new Promise((r) => setTimeout(r, 300));
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const problems = [];
const log = (msg) => console.log(`- ${msg}`);

async function walk({ width, height, suffix, notte }) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`[${width}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[${width}] console.error: ${m.text()}`);
  });
  const shot = (n, name, extra = suffix) => page.screenshot({ path: path.join(OUT, `${PREFIX}-${n}-${name}${extra}.png`) });
  const settle = (ms = 1200) => page.waitForTimeout(ms);
  const see = async (locator, what, timeout = 20000) => {
    await locator.first().waitFor({ state: 'visible', timeout }).catch(() => {
      throw new Error(`Expected to see: ${what}`);
    });
  };
  const ready = () => page.waitForFunction((real) => (real ? window.__apprenticeMock !== true : window.__apprenticeMock === true), REAL, { timeout: 15000 });
  const recorded = new Set();
  page.on('response', async (r) => {
    if (REAL && r.request().method() === 'POST' && /\/api\/recordings\/[^/]+\/stop$/.test(r.url())) recorded.add(r.url().split('/').at(-2));
  });
  const progressCurrent = async (label) => {
    const cur = await page.locator('.scr-progress [aria-current="step"]').innerText();
    if (cur.trim() !== label) throw new Error(`progress should be at ${label}, is at ${cur}`);
  };

  try {
    await steps();
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-zz-failure${suffix}.png`) }).catch(() => undefined);
    throw e;
  }
  await context.close();

  async function steps() {
  log(`${width}px: the expert studio`);
  await page.goto(`${BASE}/expert?mock=${REAL ? 0 : 1}`);
  await ready();
  await page.evaluate(() => window.sessionStorage.removeItem('apprentice.scratch.draft.v2'));
  await see(page.getByRole('link', { name: 'Start from scratch' }), 'the scratch door');
  await see(page.getByRole('link', { name: 'Generate steps' }), 'the generate door');
  await see(page.getByText('Put on the gloves and record a new skill. Name it when you are happy with it.'), 'the new scratch door copy');
  await see(page.locator('.shelf .folio'), 'skill cards on the shelf');
  const cards = (await page.locator('.shelf .folio__title').allInnerTexts()).map((t) => t.trim());
  for (const s of ['Table tennis', 'Piano', 'Fingerspelling', 'Shadow puppets']) if (cards.filter((c) => c.toLowerCase() === s.toLowerCase()).length !== 1) throw new Error(`the shelf should hold one ${s} card, holds ${cards.join(', ')}`);
  await settle(7000);
  await shot('01', 'home');
  if (notte) {
    // The theme is read once at start (it also colours the 3D stage), so switch it and reload.
    await page.evaluate(() => window.localStorage.setItem('apprentice.theme', 'notte'));
    await page.reload();
    await ready();
    await see(page.locator('.shelf .folio'), 'folios in Notte');
    await settle(7000);
    await shot('01', 'home', '-notte');
    await page.evaluate(() => window.localStorage.setItem('apprentice.theme', 'bottega'));
    await page.reload();
    await ready();
  }
  log(`${width}px: a skill page lists its lessons and offers a new one`);
  await page.locator('.shelf .folio', { hasText: /^\s*Table tennis/i }).first().click();
  await page.waitForURL(/\/expert\/skills\/table_tennis/);
  await see(page.getByRole('heading', { name: 'Table tennis' }), 'the Table tennis skill page');
  await see(page.locator('.folio__from').getByText('From the pattern book'), 'where a lesson came from');
  await see(page.getByRole('link', { name: 'Back to the studio' }), 'the way back');
  await settle(4000);
  await shot('01b', 'skill-table-tennis');
  await page.getByRole('link', { name: 'Record a new lesson for this skill' }).click();
  await see(page.getByText('A new lesson for Table tennis. You name the move when you publish.'), 'the record screen knows the skill');
  const forTt = await page.evaluate(() => JSON.parse(window.sessionStorage.getItem('apprentice.scratch.draft.v2')));
  if (forTt.skill !== 'table_tennis' || !forTt.skillLocked) throw new Error(`the draft should carry Table tennis, has ${forTt.skill}`);
  if (new URL(page.url()).search) throw new Error('the skill should leave the address once it is in the draft');
  await page.goto(`${BASE}/expert?mock=${REAL ? 0 : 1}`);
  await ready();
  await page.getByRole('link', { name: 'Start from scratch' }).click();

  log(`${width}px: record opens straight away, no catalogue`);
  await page.waitForURL(/\/expert\/scratch/);
  await see(page.getByRole('heading', { name: 'Record your move' }), 'record screen title');
  await progressCurrent('Record');
  const words = (await page.locator('.scr-progress li').allInnerTexts()).map((t) => t.trim());
  if (words.join(',') !== 'Record,Replay,Publish') throw new Error(`progress should read Record, Replay, Publish, reads ${words.join(', ')}`);
  if (await page.getByRole('radiogroup', { name: 'Skill' }).count()) throw new Error('the scratch flow should not list existing skills');
  await see(page.getByText('Take 1 of 3'), 'take counter');
  await see(page.getByText('Which hands will you use?'), 'the hands question before the first take');
  for (const h of ['Right hand', 'Left hand', 'Both hands']) await see(page.getByRole('group', { name: 'Hands' }).getByRole('button', { name: h }), `hands option ${h}`);
  if (await page.getByRole('button', { name: 'Calibrate' }).isVisible()) throw new Error('calibration should be folded into the Gloves control');
  for (const v of ['Behind the hand', 'From above', 'From the side', 'Reset view']) await see(page.getByRole('button', { name: v }), `camera button ${v}`);
  if (await page.getByRole('button', { name: 'Copy camera' }).count()) throw new Error('Copy camera is for dev mode only');
  await settle(1500);
  await shot('02', 'record');
  await page.getByRole('button', { name: 'Both hands' }).click();
  await settle(1500);
  await shot('03', 'record-hands');
  await page.getByRole('button', { name: 'Right hand' }).click();
  if ((await page.getByRole('button', { name: 'Right hand' }).getAttribute('aria-pressed')) !== 'true') throw new Error('the hands answer should stick');
  await page.locator('.scr-gloves__summary').click();
  await see(page.getByRole('button', { name: /^Calibrate/ }), 'calibrate inside the Gloves panel');
  await shot('04', 'record-gloves');
  await page.keyboard.press('Escape');

  const moveId = await page.evaluate(() => JSON.parse(window.sessionStorage.getItem('apprentice.scratch.draft.v2')).current.id);
  if (!/^free_[a-z0-9]{8}$/.test(moveId)) throw new Error(`the move should get a stable free id before the first take, has ${moveId}`);

  log(`${width}px: record three takes`);
  for (let n = 1; n <= 3; n++) {
    // The last take is still saving for a moment after it lands in the strip.
    await settle(900);
    await page.getByRole('button', { name: 'Record a take' }).click();
    await see(page.getByRole('button', { name: /^Stop/ }), `Stop for take ${n}`, 30000);
    await settle(2600);
    if (n === 1) await shot('05', 'recording');
    await page.getByRole('button', { name: /^Stop/ }).click();
    await see(page.getByRole('button', { name: `Delete take ${n}` }), `take ${n} in the strip`);
  }
  await see(page.getByText(/is your reference\./), 'takes model summary', 20000);
  await see(page.getByText(/was steadiest|sets the pace/), 'steadiest finger line');
  if (await page.getByRole('group', { name: 'Hands' }).count()) throw new Error('hands should be fixed once takes exist');
  await see(page.locator('.scr-hands__fixed').getByText('Right hand'), 'hands fixed once capture started');
  await settle(800);
  await shot('06', 'record-3-takes');

  log(`${width}px: watch a take on the stage, then back to live`);
  await page.getByRole('button', { name: 'Watch take 2' }).click();
  await see(page.getByText('Take 2, played back'), 'the stage says which take plays');
  await see(page.getByRole('button', { name: 'Back to live' }), 'the way back to the live hand');
  await see(page.getByRole('button', { name: 'Record take 2 again' }), 'redo beside the playing take');
  if ((await page.getByRole('button', { name: 'Watch take 2' }).getAttribute('aria-pressed')) !== 'true') throw new Error('the watched take should read as pressed');
  const compare = page.getByRole('button', { name: 'Compare with reference' });
  if (await compare.count()) await compare.click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByLabel('Position in take 2').fill('0.6');
  await settle(2500);
  await page.evaluate(() => window.scrollBy(0, document.querySelector('.scr-rec__stage').getBoundingClientRect().top - 12));
  await settle(600);
  await page.screenshot({ path: path.join(OUT, `${PREFIX}-record-playtake${suffix}.png`) });
  await page.getByRole('button', { name: 'Back to live' }).click();
  if (await page.getByText('Take 2, played back').count()) throw new Error('Back to live should end the playback');

  log(`${width}px: reload keeps the takes and the screen`);
  await page.reload();
  await ready();
  await see(page.getByRole('button', { name: 'Delete take 3' }), 'takes listed again after reload');
  await see(page.getByText(/is your reference\./), 'model again after reload', 20000);
  const sameId = await page.evaluate(() => JSON.parse(window.sessionStorage.getItem('apprentice.scratch.draft.v2')).current.id);
  if (sameId !== moveId) throw new Error('the move id should survive a reload');

  log(`${width}px: delete and redo a take, then back to three`);
  await page.getByRole('button', { name: 'Delete take 3' }).click();
  await page.getByRole('group', { name: 'Delete take 3?' }).getByRole('button', { name: 'Delete' }).click();
  await see(page.getByText('Take 3 of 3'), 'counter after delete');
  if (!(await page.getByRole('button', { name: 'Next: replay' }).isDisabled())) throw new Error('Next should wait for three takes');
  await page.getByRole('button', { name: 'Redo take 2' }).click();
  await see(page.getByRole('button', { name: /^Stop/ }), 'Stop for the redone take', 30000);
  await settle(2200);
  await page.getByRole('button', { name: /^Stop/ }).click();
  await see(page.getByRole('button', { name: 'Delete take 2' }), 'redone take');
  await settle(900);
  await page.getByRole('button', { name: 'Record a take' }).click();
  await see(page.getByRole('button', { name: /^Stop/ }), 'Stop for take 3 again', 30000);
  await settle(2200);
  await page.getByRole('button', { name: /^Stop/ }).click();
  await see(page.getByText(/is your reference\./), 'model after redo', 20000);
  await page.getByRole('button', { name: 'Next: replay' }).click();

  log(`${width}px: replay`);
  await progressCurrent('Replay');
  await see(page.getByRole('heading', { name: 'What the apprentice will see' }), 'replay screen');
  await see(page.getByRole('button', { name: 'Pause' }), 'transport playing');
  await page.getByRole('button', { name: '0.5x' }).click();
  await settle(2500);
  await shot('07', 'replay-strings');
  await page.getByRole('button', { name: 'Ghost' }).click();
  await settle(2000);
  await shot('08', 'replay-ghost');
  await page.getByRole('button', { name: 'Next: publish' }).click();

  log(`${width}px: publish names the skill and the move`);
  await progressCurrent('Publish');
  const skillDefault = await page.getByLabel('Skill name').inputValue();
  if (skillDefault !== 'New skill') throw new Error(`the skill name should start as "New skill", is "${skillDefault}"`);
  const moveDefault = await page.getByLabel('What this move is called').inputValue();
  if (moveDefault !== 'Move 1') throw new Error(`the move name should start as "Move 1", is "${moveDefault}"`);
  await page.getByLabel('Skill name').fill(`Pottery ${width}`);
  await page.getByLabel('What this move is called').fill('Centring the clay');
  await page.getByLabel('One line about it (optional)').fill('Both palms steady, thumbs together over the clay.');
  await page.getByLabel('Your name').fill('Maestra Rossi');
  await see(page.getByText(/3 takes; take \d is the reference/), 'publish summary');
  await see(page.getByRole('heading', { name: `Pottery ${width} teaches one move` }), 'the summary uses the new name');

  log(`${width}px: add another move goes back to Record for a fresh move, and Back returns to Publish`);
  await page.getByRole('button', { name: 'Add another move' }).click();
  await see(page.getByRole('heading', { name: 'Record move 2' }), 'record screen for move 2');
  await see(page.getByText('Take 1 of 3'), 'a fresh take counter');
  const second = await page.evaluate(() => JSON.parse(window.sessionStorage.getItem('apprentice.scratch.draft.v2')));
  if (second.current.id === moveId || second.moves.length !== 1) throw new Error('the second move should be a new free move with the first one kept');
  await page.getByRole('button', { name: 'Back to publish' }).click();
  await progressCurrent('Publish');
  if ((await page.getByLabel('Skill name').inputValue()) !== `Pottery ${width}`) throw new Error('the skill name should be kept');
  if ((await page.getByLabel('What this move is called').inputValue()) !== 'Centring the clay') throw new Error('the move name should be kept');
  await shot('09', 'publish');
  await page.getByRole('button', { name: 'Publish skill' }).click();
  await page.waitForURL(/\/expert\/lessons\//, { timeout: 15000 });
  await see(page.getByRole('heading', { name: `Pottery ${width}` }), 'lesson page');
  await settle(1500);
  await shot('10', 'lesson');

  const id = page.url().split('/expert/lessons/')[1].split(/[?#/]/)[0];
  const lesson = await page.evaluate(async (lessonId) => (await fetch(`/api/lessons/${lessonId}`)).json(), id);
  const step = lesson.steps[0];
  const fingers = step.tolerance?.finger_angle_deg ?? {};
  if (lesson.steps.length !== 1) throw new Error(`the skill should hold the one recorded move, has ${lesson.steps.length}`);
  if (lesson.skill !== 'general' || lesson.source !== 'scratch') throw new Error(`a new skill is filed as general from scratch, is ${lesson.skill} ${lesson.source}`);
  if (step.title !== 'Centring the clay' || step.move_id !== null) throw new Error(`the step should carry the move name and no catalogue id, has ${step.title} ${step.move_id}`);
  if (step.take_ids?.length !== 3) throw new Error(`step should carry 3 take ids, has ${JSON.stringify(step.take_ids)}`);
  if (!step.take_ids.includes(step.reference_recording_id)) throw new Error('the reference take should be one of the takes');
  if (Object.keys(fingers).length !== 5) throw new Error(`step should carry a tolerance per finger, has ${JSON.stringify(step.tolerance)}`);
  const labels = await page.evaluate(async (ids) => Promise.all(ids.map(async (r) => (await (await fetch(`/api/recordings/${r}`)).json()).step_id)), step.take_ids);
  const want = new RegExp(`^${moveId}:rep\\d+$`);
  if (!labels.every((l) => want.test(l))) throw new Error(`every take should be labelled ${moveId}:rep<n>, are ${labels.join(', ')}`);
  console.log(`  saved step "${step.title}": takes ${labels.join(', ')}, reference ${step.reference_recording_id}, finger_angle_deg ${JSON.stringify(fingers)}`);
  const left = await page.evaluate(() => window.sessionStorage.getItem('apprentice.scratch.draft.v2'));
  if (left) throw new Error('the draft should be cleared after publishing');

  log(`${width}px: the new skill sits first on the shelf`);
  await page.goto(`${BASE}/expert?mock=${REAL ? 0 : 1}`);
  await ready();
  await see(page.locator('.folio').first().getByText(`Pottery ${width}`), 'the new skill first on the shelf');
  await see(page.locator('.folio').first().getByText('1 lesson, 1 step'), 'its lesson count');
  await settle(5000);
  await shot('11', 'home-after');
  await page.locator('.folio').first().click();
  await see(page.getByRole('heading', { name: `Pottery ${width}` }), 'the new skill page');
  await see(page.locator('.folio__from').getByText('Recorded from scratch'), 'its source in plain words');
  if (REAL) {
    console.log(`  real backend: published lesson ${id}; deleting the ${recorded.size} takes this walk recorded`);
    await page.evaluate(async (ids) => Promise.all(ids.map((r) => fetch(`/api/recordings/${r}`, { method: 'DELETE' }))), [...recorded]);
  }
  }
}

let exitCode = 0;
try {
  if (REAL) await walk({ width: 1536, height: 760, suffix: '-real', notte: false });
  else {
    await walk({ width: 1536, height: 760, suffix: '', notte: true });
    await walk({ width: 390, height: 844, suffix: '-390', notte: false });
  }
} catch (e) {
  problems.push(`walk failed: ${e.message}`);
}

await browser.close();
vite?.kill();
if (problems.length) {
  console.log('\nPROBLEMS');
  problems.forEach((p) => console.log(`  ${p}`));
  exitCode = 1;
} else console.log(`\nExpert flow walk finished with no console or page errors. Screenshots in ${OUT}`);
process.exit(exitCode);
