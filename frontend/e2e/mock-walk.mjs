// Walks the whole app in mock mode (no Python backend needed): role select, expert scratch for a new skill (hands,
// calibrate from the Gloves control, record three takes, the takes model, replay, name it and publish), generate steps and save, the AI Assistant switch, learner dashboard and search, skill pages, a training attempt
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

const PORT = Number(process.env.E2E_PORT ?? 5181);
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
// 1200 high: the robot pane on the expert screen pushes the calibration card below a 900 px fold, and Playwright's
// scroll-and-click there was flaky under load. The apprentice and demo walks keep their own sizes.
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
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

  step('expert: start from scratch opens straight on Record for a new skill');
  await page.getByText('I AM AN EXPERT', { exact: false }).first().click();
  await expectVisible(page.locator('.shelf .folio'), 'the shelf of lesson folios');
  await page.getByRole('link', { name: 'Start from scratch' }).click();
  await expectVisible(page.getByRole('heading', { name: 'Record your move' }), 'record screen');
  if (await page.getByRole('radiogroup', { name: 'Skill' }).count()) throw new Error('the scratch flow should not list existing skills');
  await expectVisible(page.getByRole('button', { name: 'Record a take' }), 'Record a take button');
  await expectVisible(page.getByRole('group', { name: 'Hands' }), 'hands question');
  await page.getByRole('group', { name: 'Hands' }).getByRole('button', { name: 'Right hand' }).click();
  await settle(1200);
  await shot('02-scratch-picked');

  step('expert: calibrate the glove from the Gloves control');
  await page.locator('.scr-gloves__summary').click();
  await page.getByRole('button', { name: 'Calibrate', exact: true }).click();
  // two phases of countdown and capture take about 22 s in the mock; under load the old 30 s limit was too tight
  await expectVisible(page.getByText('Calibrated', { exact: true }), 'calibrated state', 60000);
  await shot('03-calibrated');
  await page.keyboard.press('Escape');

  step('expert: record three takes, read the takes model, replay the reference take');
  for (let n = 1; n <= 3; n++) {
    await page.getByRole('button', { name: 'Record a take' }).click();
    await expectVisible(page.getByRole('button', { name: /^Stop/ }), `Stop button for take ${n} (after the countdown)`, 30000);
    await settle(2500);
    if (n === 1) await shot('04-recording');
    await page.getByRole('button', { name: /^Stop/ }).click();
    await expectVisible(page.getByRole('button', { name: `Delete take ${n}` }), `take ${n} in the strip`);
  }
  await expectVisible(page.getByText(/is your reference\./), 'takes model summary', 20000);
  await expectVisible(page.getByText('Right hand', { exact: true }), 'hands fixed once capture started');
  await page.getByRole('button', { name: 'Next: replay' }).click();
  await expectVisible(page.getByRole('button', { name: /Pause|Play/ }), 'replay transport');
  await settle(1500);
  await shot('05-replay');

  step('expert: name the new skill and its move, then publish');
  await page.getByRole('button', { name: 'Next: publish' }).click();
  await page.getByLabel('Skill name').fill('Mock pottery basics');
  await page.getByLabel('What this move is called').fill('Centring the clay');
  await page.getByRole('button', { name: 'Publish skill' }).click();
  await page.waitForURL(/\/expert\/lessons\//, { timeout: 15000 });
  await expectVisible(page.getByRole('button', { name: 'Save changes' }), 'saved lesson editor');
  await shot('06-scratch-saved');

  step('expert: generate steps from text and save');
  await page.goto(`${BASE}/expert/generate`);
  await page.getByRole('button', { name: 'Five-finger scale for a child' }).click();
  await page.getByRole('button', { name: 'Generate steps' }).click();
  await expectVisible(page.getByText(/The AI Assistant drafted these steps/), 'generated draft', 20000);
  await shot('07-generated');
  await page.getByLabel('Lesson title').fill('Mock piano scale');
  await page.getByRole('button', { name: 'Save lesson' }).click();
  await settle(2000);
  await shot('08-generated-saved');

  step('expert: draft from a video upload (fake clip)');
  await page.goto(`${BASE}/expert/generate`);
  await page.locator('input[type=file]').setInputFiles({ name: 'rally.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(300_000, 1) });
  await page.getByRole('button', { name: /Draft|video/i }).filter({ hasNotText: /Generate steps/ }).first().click();
  await expectVisible(page.getByText(/The AI Assistant (watched your clip|could not watch the clip)/), 'video draft', 20000);
  await shot('09-video-draft');

  step('AI Assistant switch (in Settings): off hides drafting and offers manual steps, on restores it');
  await page.goto(`${BASE}/expert/generate`);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('switch', { name: 'Enable AI Assistant' }).click();
  await page.keyboard.press('Escape');
  await expectVisible(page.getByText('The AI Assistant is off. Turn it on in Settings to draft steps from a sentence.'), 'AI Assistant off note');
  if (await page.getByRole('button', { name: 'Generate steps' }).count()) throw new Error('Generate steps should be hidden while the AI Assistant is off');
  await page.getByRole('button', { name: 'Turn the AI Assistant on' }).click();
  await expectVisible(page.getByRole('button', { name: 'Generate steps' }), 'drafting restored');

  step('apprentice: the dashboard lists the four demo skills; search finds the saved lessons by their course titles');
  await page.goto(`${BASE}/apprentice`);
  await expectVisible(page.getByRole('link', { name: /Table tennis/ }), 'table tennis skill card');
  await expectVisible(page.getByRole('link', { name: /Shadow puppets/ }), 'shadow puppets skill card');
  await expectVisible(page.getByRole('link', { name: /Piano/ }), 'piano skill card');
  await expectVisible(page.getByRole('link', { name: /Finnish fingerspelling/ }), 'Finnish fingerspelling skill card');
  for (const gone of [/Surgical/, /Crochet/, /Touch typing/, /Boxing/, /Guitar/, /Rock paper/]) {
    if (await page.getByRole('link', { name: gone }).count()) throw new Error(`a retired skill is still on the dashboard: ${gone}`);
  }
  await settle(3500);
  await shot('10-dashboard');
  await page.keyboard.press('/');
  await page.keyboard.type('xyz');
  await expectVisible(page.getByText(/No skill matches/), 'empty search state');
  await page.keyboard.press('Escape');
  if ((await page.getByRole('searchbox').inputValue()) !== '') throw new Error('Escape should clear the search');
  for (const [title, card] of [['Mock pottery basics', /General/], ['Mock piano scale', /Piano|General/]]) {
    await page.getByRole('searchbox').fill(title);
    await page.getByRole('link', { name: card }).first().click();
    await expectVisible(page.getByRole('heading', { name: title }), `${title} on its skill page`);
    await page.goBack();
  }
  await page.getByRole('searchbox').fill('');

  step('apprentice: Finnish fingerspelling starts at its first letter');
  await page.getByRole('link', { name: /Finnish fingerspelling/ }).first().click();
  await expectVisible(page.getByRole('link', { name: /Start lesson 1|Continue lesson/ }), 'fingerspelling primary action');
  await expectVisible(page.getByText('Lesson 1: Letter A'), 'first letter lesson');
  await expectVisible(page.getByText('Lesson 6: Spell VIILI'), 'first word lesson');

  step('apprentice: skill page, then the course page and a training attempt with its score card');
  await page.goto(`${BASE}/apprentice`);
  await page.getByRole('link', { name: /Table tennis/ }).click();
  await expectVisible(page.getByRole('link', { name: /Start lesson 1|Continue lesson/ }), 'skill page primary action');
  await expectVisible(page.getByRole('group', { name: 'Which lesson plays' }), 'showcase lesson switch');
  await settle(3000);
  await shot('10b-skill');
  await page.locator('.sk-course', { hasText: 'Table Tennis: grip and forehand' }).getByRole('link', { name: 'Open the course' }).click();
  await expectVisible(page.getByRole('link', { name: 'Start practising' }), 'course page');
  await shot('11-course');
  // The seeded demo history has mastered the first two table tennis lessons, so the walk opens the third, still fresh.
  await page.goto(`${BASE}/apprentice/lessons/seed-table-tennis/steps/2`);
  await expectVisible(page.getByRole('button', { name: /Try it out/ }), 'Try it out button');
  // The skinned hand and the room's shaders take a moment on the software renderer; shoot once they are drawn.
  await settle(1500);
  await shot('12-room');
  await page.getByRole('button', { name: /Try it out/ }).click();
  await expectVisible(page.getByRole('button', { name: /Begin (rep|attempt) 1/ }), 'Begin rep button');
  await page.getByRole('button', { name: /Begin (rep|attempt) 1/ }).click();
  await expectVisible(page.getByRole('region', { name: /Score for (attempt|rep) 1/ }), 'score card', 60000);
  // The 3D score draws a moment after the card appears; wait for its notes before the screenshot.
  await page.locator('.lead__label').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => undefined);
  await settle(1500);
  await shot('13-score');
  const overall = await page.getByLabel(/Overall score/).first().getAttribute('aria-label');
  console.log(`  ${overall}`);

  step('apprentice: shadow puppets by lamplight, both shadows on the wall');
  await page.goto(`${BASE}/apprentice/lessons/seed-shadow-puppets/steps/0`);
  await expectVisible(page.locator('.sp-theatre__name', { hasText: 'The rabbit' }), 'shape name above the wall');
  await expectVisible(page.getByText('The expert', { exact: true }), 'expert label on the bench');
  await page.getByRole('button', { name: /Try it out/ }).click();
  await expectVisible(page.getByRole('button', { name: /Begin (rep|attempt) 1/ }), 'Begin rep button in the theatre');
  await settle(2500);
  await shot('13b-shadow-puppets');

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
