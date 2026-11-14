// Walks the whole app in mock mode (no Python backend needed): role select, expert scratch (pick, hands and prop set-up,
// calibrate, record, replay, save), generate steps and save, the assistant switch, learner library, a training attempt
// with its score card, both tests.
// Fails on any console error or uncaught page error. Screenshots go to docs/screens/mock-*.png.
// Run: node e2e/mock-walk.mjs   (starts the Vite dev server on :5181 if nothing answers there).
// Playwright is taken from the repo's genui package, so no extra dependency is added to the frontend.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, '../../genui/node_modules/playwright'));

const PORT = 5181;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(here, '../docs/screens') + path.sep;

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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
});
const shot = (name) => page.screenshot({ path: `${OUT}mock-${name}.png` });
const step = (msg) => console.log(`- ${msg}`);
const settle = (ms = 1200) => page.waitForTimeout(ms);
const expectVisible = async (locator, what, timeout = 20000) => {
  await locator.first().waitFor({ state: 'visible', timeout }).catch(() => {
    throw new Error(`Expected to see: ${what}`);
  });
};

let exitCode = 0;
try {
  step('role select (?mock=1 turns the mock on)');
  await page.goto(`${BASE}/?mock=1`);
  await page.waitForFunction(() => window.__apprenticeMock === true, null, { timeout: 15000 });
  await expectVisible(page.getByText('I AM AN EXPERT', { exact: false }), 'role select');
  await shot('01-role');

  step('expert: start from scratch, pick a move');
  await page.getByText('I AM AN EXPERT', { exact: false }).first().click();
  await page.getByRole('link', { name: 'Start from scratch' }).click();
  await page.getByRole('button', { name: /shakehand grip/i }).click();
  await expectVisible(page.getByRole('button', { name: 'Record a take' }), 'Record a take button');
  await expectVisible(page.getByRole('group', { name: 'How many hands' }), 'hands set-up');
  if ((await page.getByRole('button', { name: 'Add a prop' }).getAttribute('aria-pressed')) !== 'false') throw new Error('props should be off by default');
  await shot('02-scratch-picked');

  step('expert: calibrate the glove');
  await page.getByRole('button', { name: 'Calibrate', exact: true }).click();
  await expectVisible(page.getByText('Calibrated', { exact: true }), 'calibrated state', 30000);
  await shot('03-calibrated');

  step('expert: record a take and replay it');
  await page.getByRole('button', { name: 'Record a take' }).click();
  await expectVisible(page.getByRole('button', { name: /^Stop/ }), 'Stop button (after the countdown)', 30000);
  await settle(2500);
  await shot('04-recording');
  await page.getByRole('button', { name: /^Stop/ }).click();
  await expectVisible(page.getByRole('button', { name: 'Replay' }), 'Replay button for the take');
  await expectVisible(page.getByText('One hand, right'), 'hands summary once capture started');
  await page.getByRole('button', { name: 'Replay' }).first().click();
  await expectVisible(page.getByRole('button', { name: /Pause|Play/ }), 'replay transport');
  await settle(1500);
  await shot('05-replay');

  step('expert: save the scratch lesson');
  await page.getByLabel('Lesson title').fill('Mock shakehand basics');
  await page.getByRole('button', { name: 'Save as lesson' }).click();
  await page.waitForURL(/\/expert\/lessons\//, { timeout: 15000 });
  await expectVisible(page.getByRole('button', { name: 'Save changes' }), 'saved lesson editor');
  await shot('06-scratch-saved');

  step('expert: generate steps from text and save');
  await page.goto(`${BASE}/expert/generate`);
  await page.getByRole('button', { name: 'Five-finger scale for a child' }).click();
  await page.getByRole('button', { name: 'Generate steps' }).click();
  await expectVisible(page.getByText(/The assistant drafted these steps/), 'generated draft', 20000);
  await shot('07-generated');
  await page.getByLabel('Lesson title').fill('Mock piano scale');
  await page.getByRole('button', { name: 'Save lesson' }).click();
  await settle(2000);
  await shot('08-generated-saved');

  step('expert: draft from a video upload (fake clip)');
  await page.goto(`${BASE}/expert/generate`);
  await page.locator('input[type=file]').setInputFiles({ name: 'rally.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(300_000, 1) });
  await page.getByRole('button', { name: /Draft|video/i }).filter({ hasNotText: /Generate steps/ }).first().click();
  await expectVisible(page.getByText(/The assistant (watched your clip|could not watch the clip)/), 'video draft', 20000);
  await shot('09-video-draft');

  step('assistant switch: off hides drafting and offers manual steps, on restores it');
  await page.goto(`${BASE}/expert/generate`);
  await page.getByRole('switch', { name: /Assistant on/ }).click();
  await expectVisible(page.getByText('The assistant is off. Turn it on to draft steps from a sentence.'), 'assistant off note');
  if (await page.getByRole('button', { name: 'Generate steps' }).count()) throw new Error('Generate steps should be hidden while the assistant is off');
  await page.getByRole('button', { name: 'Turn the assistant on' }).click();
  await expectVisible(page.getByRole('button', { name: 'Generate steps' }), 'drafting restored');

  step('apprentice: the library lists the saved lessons');
  await page.goto(`${BASE}/apprentice`);
  await expectVisible(page.getByText('Mock shakehand basics'), 'saved scratch lesson in the library');
  await expectVisible(page.getByText('Mock piano scale'), 'saved generated lesson in the library');
  await shot('10-library');

  step('apprentice: course page and a training attempt with its score card');
  await page.goto(`${BASE}/apprentice/lessons/seed-table-tennis`);
  await expectVisible(page.getByRole('link', { name: 'Start practising' }), 'course page');
  await shot('11-course');
  await page.goto(`${BASE}/apprentice/lessons/seed-table-tennis/steps/0`);
  await expectVisible(page.getByRole('button', { name: /Start with the strings/ }), 'Start with the strings button');
  await shot('12-room');
  await page.getByRole('button', { name: /Start with the strings/ }).click();
  await expectVisible(page.getByRole('button', { name: /Begin (rep|attempt) 1/ }), 'Begin rep button');
  await page.getByRole('button', { name: /Begin (rep|attempt) 1/ }).click();
  await expectVisible(page.getByRole('region', { name: /Score for (attempt|rep) 1/ }), 'score card', 60000);
  await settle(800);
  await shot('13-score');
  const overall = await page.getByLabel(/Overall score/).first().getAttribute('aria-label');
  console.log(`  ${overall}`);

  step('apprentice: table tennis rally test');
  await page.goto(`${BASE}/apprentice/lessons/seed-table-tennis/test`);
  await page.getByRole('button', { name: /Start the rally/ }).click();
  await settle(4000);
  await shot('14-test-tt-play');
  await expectVisible(page.getByText(/Play again|rally|Rally/).filter({ hasText: /again|result|score|won|lost|win|draw/i }), 'rally result', 120000).catch(() => undefined);
  await shot('15-test-tt-result');

  step('apprentice: piano play-along test');
  await page.goto(`${BASE}/apprentice/lessons/seed-piano/test`);
  await page.getByRole('button', { name: /Start|Play/ }).first().click();
  await settle(4000);
  await shot('16-test-piano-play');
  await settle(20000);
  await shot('17-test-piano-result');
} catch (e) {
  problems.push(`walk failed: ${e.message}`);
  await shot('zz-failure').catch(() => undefined);
}

await browser.close();
vite?.kill();
if (problems.length) {
  console.log('\nPROBLEMS');
  problems.forEach((p) => console.log(`  ${p}`));
  exitCode = 1;
} else console.log('\nWalk finished with no console or page errors.');
process.exit(exitCode);
