// Walks touch typing in mock mode (no Python backend needed): the skill page, a lesson room at the desk, the air typing
// game to its result, and the "Type on your keyboard" mode until the simulated glove shows a fingering correction.
// Fails on any console error or uncaught page error. Screenshots go to docs/screens/typing-*.png.
// Run: node e2e/typing-walk.mjs   (starts the Vite dev server on :5184 if nothing answers there; E2E_PORT picks the port).
// Playwright is taken from the repo's genui package (E2E_PLAYWRIGHT overrides the path), so the frontend gains no dependency.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pw = process.env.E2E_PLAYWRIGHT ?? path.resolve(here, '../../genui/node_modules/playwright');
if (!existsSync(pw)) throw new Error(`Playwright not found at ${pw}; set E2E_PLAYWRIGHT`);
const { chromium } = require(pw);

const PORT = Number(process.env.E2E_PORT ?? 5184);
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
const shot = (name) => page.screenshot({ path: `${OUT}typing-${name}.png` });
const step = (msg) => console.log(`- ${msg}`);
const settle = (ms = 1200) => page.waitForTimeout(ms);
const expectVisible = async (locator, what, timeout = 20000) => {
  await locator.first().waitFor({ state: 'visible', timeout }).catch(() => {
    throw new Error(`Expected to see: ${what}`);
  });
};

let exitCode = 0;
try {
  step('skill page: touch typing is live, the expert plays the drills at the desk');
  await page.goto(`${BASE}/apprentice?mock=1`);
  await page.waitForFunction(() => window.__apprenticeMock === true, null, { timeout: 15000 });
  await page.getByRole('link', { name: /Touch typing/ }).first().click();
  await expectVisible(page.getByRole('link', { name: /Start lesson 1|Continue lesson/ }), 'skill page primary action');
  await expectVisible(page.getByRole('group', { name: 'Which lesson plays' }), 'showcase lesson switch');
  await settle(3500);
  await shot('01-skill');

  step('lesson room: F and J at the desk, both hands over the chalk keyboard, the expert as ghosts');
  await page.goto(`${BASE}/apprentice/lessons/seed-touch-typing/steps/1`);
  await expectVisible(page.getByRole('button', { name: /Start with the strings/ }), 'Start with the strings button');
  await settle(3000);
  await shot('02-room');
  await page.getByRole('button', { name: /Start with the strings/ }).click();
  await expectVisible(page.getByRole('button', { name: /Begin (rep|attempt) 1/ }), 'Begin rep button at the desk');
  await page.getByRole('button', { name: /Begin (rep|attempt) 1/ }).click();
  await settle(4500);
  await shot('03-room-rep');

  step('air typing: intro, words one at a time, a correction, then the result');
  await page.goto(`${BASE}/apprentice/lessons/seed-touch-typing/test`);
  await expectVisible(page.getByRole('radio', { name: 'Air typing' }), 'mode switch');
  await expectVisible(page.getByRole('button', { name: 'Start typing' }), 'air typing intro');
  await settle(2500);
  await shot('04-air-intro');
  await page.getByRole('button', { name: 'Start typing' }).click();
  await expectVisible(page.locator('.ty-word'), 'the word on the stage');
  await expectVisible(page.locator('.ty-letter--ok'), 'a letter struck with the right finger', 30000);
  await settle(1500);
  await shot('05-air-play');
  await expectVisible(page.locator('.ty-callout--off'), 'a wrong finger called out', 40000);
  await shot('06-air-correction');
  await expectVisible(page.getByRole('region', { name: 'Test result' }), 'air typing result', 60000);
  const wpm = await page.locator('.ap-result__split li', { hasText: 'words per minute' }).innerText();
  console.log(`  ${wpm.replace(/\s+/g, ' ')}`);
  await settle(800);
  await shot('07-air-result');

  step('type on your keyboard: the simulated glove names the finger for every key and corrects a wrong one');
  await page.getByRole('radio', { name: 'Type on your keyboard' }).click();
  await expectVisible(page.locator('.ty-line'), 'the practice line');
  await settle(2000);
  const line = (await page.locator('.ty-line').getAttribute('aria-label')).replace(/^Type: /, '');
  let corrected = false;
  for (const ch of line) {
    await page.keyboard.press(ch === ' ' ? 'Space' : ch);
    await settle(260);
    if (await page.locator('.ty-callout--off').count()) {
      corrected = true;
      break;
    }
  }
  if (!corrected) throw new Error('expected a fingering correction from the simulated glove');
  const text = await page.locator('.ty-callout--off').innerText();
  console.log(`  ${text}`);
  if (!/You pressed .+ with your .+; use your .+\./.test(text)) throw new Error(`unexpected correction wording: ${text}`);
  await shot('08-keys-correction');

  step('the real-looking keyboard with "Add a prop"');
  await page.getByRole('button', { name: 'Add a prop' }).click();
  for (const ch of 'abc') {
    await page.keyboard.press(ch);
    await settle(200);
  }
  await settle(1500);
  await shot('09-keys-prop');
  await page.getByRole('button', { name: 'Add a prop' }).click();
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
