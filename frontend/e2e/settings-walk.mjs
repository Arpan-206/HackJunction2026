// Walks the Settings panel and the score views in mock mode (no Python backend needed): the panel is a real modal
// (focus moves in, Tab stays inside, Escape closes and focus returns to the Settings button), the AI Assistant switch,
// the margin of error reaching the room and the score screen, reduced motion, and the 3D score flipping to the flat chart
// and back by click and by keyboard. Desktop and phone widths.
// Fails on any console error or uncaught page error. Screenshots go to docs/screens/settings-*.png.
// Run: node e2e/settings-walk.mjs   (starts the Vite dev server on :5182 if nothing answers there).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, '../../genui/node_modules/playwright'));

const PORT = Number(process.env.E2E_PORT ?? 5182);
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
const problems = [];
let current = null;
const step = (msg) => console.log(`- ${msg}`);
const fail = (msg) => {
  throw new Error(msg);
};

async function newPage(viewport) {
  const page = await browser.newPage({ viewport });
  current = page;
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  return page;
}

const visible = async (locator, what, timeout = 20000) => {
  await locator.first().waitFor({ state: 'visible', timeout }).catch(() => fail(`Expected to see: ${what}`));
};

/** Opens the training room of the seeded table tennis lesson and plays one rep to its score. */
async function playRep(page, extra = '') {
  await page.goto(`${BASE}/apprentice/lessons/seed-table-tennis/steps/0?mock=1${extra}`);
  await page.waitForFunction(() => window.__apprenticeMock === true, null, { timeout: 15000 });
  // The first visit starts with Watch; a later one remembers the stage and offers the next rep straight away.
  const begin = page.getByRole('button', { name: /Begin rep \d+/ });
  const watch = page.getByRole('button', { name: /Try it out|Start with the strings/ });
  await visible(begin.or(watch), 'room ready');
  if (await watch.count()) await watch.click();
  await begin.click();
  await visible(page.getByRole('region', { name: /Score for attempt \d+/ }), 'score card', 60000);
}

/** Fails when two visible boxes overlap: the score view and the detail column must never cover each other. */
async function noOverlap(page, a, b, what) {
  const [ra, rb] = await Promise.all([page.locator(a).first().boundingBox(), page.locator(b).first().boundingBox()]);
  if (!ra || !rb) fail(`missing box for ${what}`);
  const overlap = ra.x < rb.x + rb.width && rb.x < ra.x + ra.width && ra.y < rb.y + rb.height && rb.y < ra.y + ra.height;
  if (overlap) fail(`${what} overlap`);
}

let exitCode = 0;
try {
  const page = await newPage({ width: 1440, height: 900 });

  step('the rail has a Settings entry and the AI Assistant state');
  await page.goto(`${BASE}/apprentice?mock=1`);
  await page.waitForFunction(() => window.__apprenticeMock === true, null, { timeout: 15000 });
  const opener = page.getByRole('button', { name: 'Settings' });
  await visible(opener, 'Settings button');
  await visible(page.getByText('AI Assistant on'), 'AI Assistant state line');

  step('Settings opens a modal dialog with focus inside');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await visible(dialog, 'Settings dialog');
  if (!(await dialog.evaluate((d) => d.contains(document.activeElement)))) fail('focus should move into the dialog');
  if ((await page.locator('#root').getAttribute('inert')) === null) fail('the app behind the dialog should be inert');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}settings-01-panel.png` });

  step('Tab stays inside the dialog');
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    if (!(await dialog.evaluate((d) => d.contains(document.activeElement)))) fail(`Tab ${i + 1} left the dialog`);
  }
  await page.keyboard.press('Shift+Tab');
  if (!(await dialog.evaluate((d) => d.contains(document.activeElement)))) fail('Shift+Tab left the dialog');

  step('Escape closes and returns focus to Settings');
  await page.keyboard.press('Escape');
  if (await dialog.count()) fail('Escape should close the dialog');
  if (!(await opener.evaluate((b) => b === document.activeElement))) fail('focus should return to the Settings button');

  step('Enable AI Assistant switch, margin, score view and reduced motion apply and persist');
  await opener.click();
  const ai = dialog.getByRole('switch', { name: 'Enable AI Assistant' });
  if ((await ai.getAttribute('aria-checked')) !== 'true') fail('AI Assistant should be on by default');
  await ai.click();
  await visible(page.getByText('AI Assistant off'), 'rail says off');
  await dialog.getByRole('radio', { name: /Relaxed/ }).check();
  await dialog.getByRole('switch', { name: 'Reduce motion' }).click();
  if ((await page.evaluate(() => document.documentElement.hasAttribute('data-reduce-motion'))) !== true) fail('reduce motion should mark the root');
  await page.screenshot({ path: `${OUT}settings-02-changed.png` });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await page.waitForFunction(() => window.__apprenticeMock === true, null, { timeout: 15000 });
  await visible(page.getByText('AI Assistant off'), 'AI Assistant off after reload');
  const stored = await page.evaluate(() => [localStorage.getItem('apprentice.margin'), localStorage.getItem('apprentice.assistant'), localStorage.getItem('apprentice.reduceMotion')]);
  if (stored.join() !== 'relaxed,0,1') fail(`settings not persisted: ${stored.join()}`);

  step('drafting is gated while the AI Assistant is off');
  await page.goto(`${BASE}/expert/generate?mock=1`);
  await visible(page.getByText('The AI Assistant is off. Turn it on in Settings to draft steps from a sentence.'), 'AI Assistant off note');

  step('the room shows the widened room for error; the score names the margin');
  await playRep(page);
  await visible(page.getByText(/Judged with a relaxed margin of error: 27 degrees per finger and 375 ms of timing/), 'margin line on the score');
  await page.waitForTimeout(2500);
  await noOverlap(page, '.ap-scoreview', '.ap-score__detail', 'score view and detail column');
  await page.screenshot({ path: `${OUT}settings-03-score-3d-relaxed.png` });

  step('click the 3D score to flip to the flat chart, and back with the button');
  const scene = page.getByRole('button', { name: /^Score in 3D/ });
  await scene.click();
  await visible(page.getByRole('list', { name: 'Score per finger' }), 'flat chart');
  await page.screenshot({ path: `${OUT}settings-04-score-2d.png` });
  await page.getByRole('button', { name: 'Show in 3D' }).click();
  await visible(scene, '3D score again');

  step('keyboard: Enter on the 3D score flips it');
  await scene.focus();
  await page.keyboard.press('Enter');
  await visible(page.getByRole('list', { name: 'Score per finger' }), 'flat chart by keyboard');

  step('standard margin, 2D chosen in Settings: the next score opens flat');
  await page.evaluate(() => {
    localStorage.setItem('apprentice.margin', 'standard');
    localStorage.setItem('apprentice.scoreView', '2d');
    localStorage.setItem('apprentice.assistant', '1');
    localStorage.removeItem('apprentice.reduceMotion');
  });
  await playRep(page);
  await visible(page.getByRole('list', { name: 'Score per finger' }), 'flat chart by default');
  await visible(page.getByText(/Judged with the expert's standard margin of error: 18 degrees/), 'standard margin line');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}settings-05-score-2d-standard.png` });

  step('strict margin, clumsy apprentice (dev): the 3D score marks the one correction in vermilion');
  await page.evaluate(() => {
    localStorage.setItem('apprentice.margin', 'strict');
    localStorage.setItem('apprentice.scoreView', '3d');
  });
  await page.goto(`${BASE}/apprentice/lessons/seed-table-tennis/steps/0?mock=1&dev=1`);
  await playRep(page, '&dev=1');
  await visible(page.getByText(/Judged with a strict margin of error: 11 degrees per finger and 150 ms/), 'strict margin line');
  await page.waitForTimeout(2500);
  await noOverlap(page, '.ap-scoreview', '.ap-score__detail', 'score view and detail column (strict)');
  await page.screenshot({ path: `${OUT}settings-08-score-3d-strict-clumsy.png` });
  await page.getByRole('button', { name: /^Score in 3D/ }).click();
  await page.screenshot({ path: `${OUT}settings-09-score-2d-strict-clumsy.png` });
  await page.close();

  step('phone width: Settings in the bottom bar, the panel fits, the score stacks');
  const phone = await newPage({ width: 390, height: 844 });
  await phone.goto(`${BASE}/apprentice?mock=1`);
  await phone.waitForFunction(() => window.__apprenticeMock === true, null, { timeout: 15000 });
  await phone.getByRole('button', { name: 'Settings' }).click();
  const pd = phone.getByRole('dialog', { name: 'Settings' });
  await visible(pd, 'Settings on a phone');
  const box = await pd.boundingBox();
  if (!box || box.x < 0 || box.x + box.width > 390) fail('the panel should fit the phone width');
  await phone.waitForTimeout(400);
  await phone.screenshot({ path: `${OUT}settings-06-phone-panel.png` });
  await phone.keyboard.press('Escape');
  await playRep(phone);
  await phone.waitForTimeout(2500);
  await phone.screenshot({ path: `${OUT}settings-07-phone-score.png` });
  await phone.mouse.wheel(0, 700);
  await phone.waitForTimeout(400);
  await phone.screenshot({ path: `${OUT}settings-07b-phone-score-detail.png` });
  await phone.close();
} catch (e) {
  problems.push(`walk failed: ${e.message}`);
  await current?.screenshot({ path: `${OUT}settings-zz-failure.png` }).catch(() => undefined);
}

await browser.close();
vite?.kill();
if (problems.length) {
  console.log('\nPROBLEMS');
  problems.forEach((p) => console.log(`  ${p}`));
  exitCode = 1;
} else console.log('\nSettings walk finished with no console or page errors.');
process.exit(exitCode);
