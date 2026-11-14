// Walks the demo kiosk (/demo): the kiosk lock, the 20 second guest calibration (flat, fist, thumb folded), a lesson,
// the live score beside the robot twin, and "Next visitor" back to the start.
// Two modes:
//   node e2e/demo-walk.mjs                 mock mode (?mock=1&nocore=1, no Python): browser score, in-browser robot.
//   DEMO_CORE=1 node e2e/demo-walk.mjs     against python -m core --fake on DEMO_CORE_PORT (default 8765): the core's
//                                          lessons, the core's live score and its robot. The backend may be up or not
//                                          (the calibration goes to it, or to the mock when it is down).
// Fails on any console error or uncaught page error. Screenshots go to docs/screens/demo-*.png.
// Playwright is taken from the repo's genui package, so no extra dependency is added to the frontend.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, '../../genui/node_modules/playwright'));

const PORT = Number(process.env.E2E_PORT ?? 5189);
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(here, '../docs/screens') + path.sep;
const CORE = process.env.DEMO_CORE === '1';
const CORE_PORT = Number(process.env.DEMO_CORE_PORT ?? 8765);
const tag = CORE ? 'core' : 'mock';
// Mock mode points the robot socket at this origin (the in-browser robot), so a core that happens to run is untouched.
const env = CORE
  ? { VITE_CORE_WS: `ws://localhost:${CORE_PORT}/ws`, VITE_ROBOT_WS: `ws://localhost:${CORE_PORT}/ws/robot` }
  : { VITE_ROBOT_WS: `ws://localhost:${PORT}/ws/robot` };
const QUERY = CORE ? '?kiosk=1' : '?kiosk=1&mock=1&nocore=1';

async function up(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

if (CORE && !(await up(`http://localhost:${CORE_PORT}/health`))) {
  console.error(`DEMO_CORE=1 but no core answers on :${CORE_PORT}. Start it with: python -m core --fake`);
  process.exit(2);
}

let vite = null;
if (!(await up(BASE))) {
  const bin = path.resolve(here, '../node_modules/vite/bin/vite.js');
  vite = spawn(process.execPath, [bin, '--port', String(PORT), '--strictPort'], { cwd: path.resolve(here, '..'), stdio: 'ignore', env: { ...process.env, ...env } });
  for (let i = 0; i < 100 && !(await up(BASE)); i++) await new Promise((r) => setTimeout(r, 300));
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
});
const shot = (name) => page.screenshot({ path: `${OUT}demo-${tag}-${name}.png` });
const step = (msg) => console.log(`- ${msg}`);
const expectVisible = async (locator, what, timeout = 20000) => {
  await locator.first().waitFor({ state: 'visible', timeout }).catch(() => {
    throw new Error(`Expected to see: ${what}`);
  });
};
const welcome = () => page.getByRole('heading', { name: 'Your hand drives a robot hand' });

let exitCode = 0;
try {
  step(`kiosk on (${QUERY})`);
  await page.goto(`${BASE}/demo${QUERY}`);
  await expectVisible(welcome(), 'the welcome screen');
  if (!CORE && !(await page.evaluate(() => window.__apprenticeMock === true))) throw new Error('mock mode did not install');
  await shot('01-welcome');

  step('kiosk: other screens, the rail, Settings and the dev panel are not reachable');
  for (const p of ['/', '/apprentice', '/expert', '/gloves', '/robot?dev=1']) {
    await page.goto(`${BASE}${p}`);
    await page.waitForURL(/\/demo$/, { timeout: 10000 }).catch(() => {
      throw new Error(`kiosk let ${p} through (at ${page.url()})`);
    });
    await expectVisible(welcome(), `the welcome screen after ${p}`);
  }
  if (await page.locator('nav[aria-label="Main"]').count()) throw new Error('the rail is visible in kiosk mode');
  if (await page.getByRole('button', { name: /Settings/ }).count()) throw new Error('Settings is reachable in kiosk mode');
  if (await page.locator('aside[aria-label="Developer panel"]').count()) throw new Error('the dev panel shows in kiosk mode');
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('.demo h1, .demo h2, .demo p, .demo button, .demo li')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => ({ text: el.textContent?.trim().slice(0, 40), px: parseFloat(getComputedStyle(el).fontSize) }))
      .filter((x) => x.px < 16),
  );
  if (small.length) throw new Error(`text under 16 px: ${JSON.stringify(small.slice(0, 5))}`);

  step('guest calibration: flat, fist, thumb folded');
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Start' }).click();
  await expectVisible(page.getByRole('heading', { name: '1 of 3: Flat hand' }), 'the flat hand pose');
  await shot('02-flat');
  await expectVisible(page.getByRole('heading', { name: '2 of 3: Fist' }), 'the fist pose', 15000);
  await expectVisible(page.getByRole('heading', { name: '3 of 3: Thumb folded' }), 'the thumb folded pose', 15000);
  await shot('03-thumb');
  await expectVisible(page.getByRole('heading', { name: 'Pick a lesson' }), 'the lesson list', 30000);
  const took = (Date.now() - t0) / 1000;
  console.log(`  calibration took ${took.toFixed(1)} s`);
  if (took > 25) throw new Error(`guest calibration took ${took.toFixed(1)} s, over 25`);
  const saved = await page.evaluate(async () => {
    const cal = await fetch('/api/calibrations/latest?side=right').then((r) => r.json());
    const wearer = await fetch('/api/gloves/calibrations').then((r) => r.json());
    return { thumb: !!cal.thumb, flat: !!cal.flat, ranges: wearer[0]?.range_calibration_ids ?? {}, name: wearer[0]?.wearer ?? '' };
  });
  console.log(`  saved: ${JSON.stringify(saved)}`);
  if (!saved.thumb || !saved.flat) throw new Error('the guest calibration did not store flat and thumb');
  if (!saved.name.startsWith('Guest') || !saved.ranges.right) throw new Error('the guest neutral record is not linked to its range');
  await shot('04-pick');

  step('pick the first lesson');
  const first = page.locator('.demo__lesson').first();
  const lessonTitle = (await first.locator('.demo__lesson-title').innerText()).trim();
  console.log(`  lesson: ${lessonTitle}`);
  if (CORE && !/fake/i.test(lessonTitle)) throw new Error(`expected a core lesson, got ${lessonTitle}`);
  await first.click();
  await expectVisible(page.getByRole('heading', { name: lessonTitle }), 'the live screen');
  await expectVisible(page.locator('.demo__twin canvas'), 'the robot twin');
  await page.waitForFunction(() => /^\d{1,3}$/.test(document.querySelector('.demo__score')?.textContent ?? '') || !!document.querySelector('.demo__mastered'), null, { timeout: 15000 }).catch(() => {
    throw new Error('no live score appeared');
  });
  await page.waitForTimeout(2500);
  const score = await page.locator('.demo__score, .demo__mastered').first().innerText();
  console.log(`  live score: ${score}`);
  await shot('05-live');

  step('next visitor');
  await page.getByRole('button', { name: 'Next visitor' }).first().click();
  await expectVisible(welcome(), 'the welcome screen for the next visitor');
  const current = await page.locator('.demo__step--now').innerText();
  if (!/Calibrate/.test(current)) throw new Error(`after the reset the current step is "${current}"`);
  await shot('06-next-visitor');
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
