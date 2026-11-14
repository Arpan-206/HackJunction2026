// Walks the robot twin: the /robot screen, the training room with the robot pane, and the expert studio's robot fold.
// Two modes:
//   node e2e/robot-walk.mjs                 mock mode (?mock=1, no Python): the in-browser robot follows the sample glove.
//   ROBOT_CORE=1 node e2e/robot-walk.mjs    against the core on ws://localhost:8765/ws/robot (ROBOT_CORE_PORT moves it) (python -m core --fake, or
//                                           --replay on a capture): switches the source, waits for live joint targets.
// Fails on any console error or uncaught page error. Screenshots go to docs/screens/robot-*.png.
// Playwright is taken from the repo's genui package, so no extra dependency is added to the frontend.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, '../../genui/node_modules/playwright'));

const PORT = Number(process.env.E2E_PORT ?? 5188);
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(here, '../docs/screens') + path.sep;
const CORE = process.env.ROBOT_CORE === '1';
// The core's port. The walk hands Vite a VITE_ROBOT_WS so the store tries it first: the core in core mode, and this
// origin (the in-browser mock) in mock mode, so a mock walk never switches the source of a core that happens to run.
const CORE_PORT = Number(process.env.ROBOT_CORE_PORT ?? 8765);
const ROBOT_WS = CORE ? `ws://localhost:${CORE_PORT}/ws/robot` : `ws://localhost:${PORT}/ws/robot`;
const tag = CORE ? 'core' : 'mock';

async function up(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

if (CORE) {
  const health = await fetch(`http://localhost:${CORE_PORT}/health`).then((r) => r.json()).catch(() => null);
  if (!health?.robot?.model) {
    console.error(`ROBOT_CORE=1 but no core with a robot model answers on :${CORE_PORT} (got ${JSON.stringify(health)})`);
    process.exit(2);
  }
  console.log(`core: robot ${health.robot.model}, source ${health.robot.source}, hands ${JSON.stringify(health.hands)}`);
}

let vite = null;
if (!(await up(BASE))) {
  const bin = path.resolve(here, '../node_modules/vite/bin/vite.js');
  vite = spawn(process.execPath, [bin, '--port', String(PORT), '--strictPort'], { cwd: path.resolve(here, '..'), stdio: 'ignore', env: { ...process.env, VITE_ROBOT_WS: ROBOT_WS } });
  for (let i = 0; i < 100 && !(await up(BASE)); i++) await new Promise((r) => setTimeout(r, 300));
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
});
const shot = (name) => page.screenshot({ path: `${OUT}robot-${tag}-${name}.png` });
const step = (msg) => console.log(`- ${msg}`);
const settle = (ms = 1200) => page.waitForTimeout(ms);
const expectVisible = async (locator, what, timeout = 20000) => {
  await locator.first().waitFor({ state: 'visible', timeout }).catch(() => {
    throw new Error(`Expected to see: ${what}`);
  });
};
const stateText = () => page.locator('.rb-state').first().innerText();
const fidelityOf = async (name) => (await page.locator('.rb-fidelity__row', { hasText: name }).locator('.rb-fidelity__value').first().getAttribute('aria-label')) ?? '';

let exitCode = 0;
try {
  step('/robot: the twin, the source switch and the fidelity rows');
  // Mock mode is forced so the walk never depends on the Python backend; the robot endpoint is chosen by the store.
  await page.goto(`${BASE}/robot?mock=1`);
  await page.waitForFunction(() => window.__apprenticeMock === true, null, { timeout: 15000 });
  await expectVisible(page.getByRole('heading', { name: 'Robot hand' }), 'Robot hand heading');
  await expectVisible(page.getByRole('radiogroup', { name: 'Robot source' }), 'source switch');
  for (const label of ['Expert glove', 'Apprentice glove', 'Lesson', 'Off']) await expectVisible(page.getByRole('radio', { name: label }), `${label} option`);
  await expectVisible(page.getByRole('list', { name: 'Fidelity per finger' }), 'fidelity list');
  // The engine (mock or core) must answer with a hello before anything else is judged.
  await page.waitForFunction(() => !/Looking for|not connected/.test(document.querySelector('.rb-state')?.textContent ?? ''), null, { timeout: 20000 });
  console.log(`  state: ${await stateText()}`);

  step('switch to the apprentice glove and wait for live joint targets');
  await page.getByRole('radio', { name: 'Apprentice glove' }).click();
  await page.waitForFunction(() => /Following the apprentice glove/.test(document.querySelector('.rb-state')?.textContent ?? ''), null, { timeout: 20000 });
  console.log(`  state: ${await stateText()}`);
  await page.locator('.rb-joints summary').click();
  await expectVisible(page.locator('.rb-joints__table'), 'joint table');
  const rows = await page.locator('.rb-joints__table tbody tr').count();
  if (rows !== 7) throw new Error(`expected 7 Dex3-1 joints in the table, saw ${rows}`);
  const readTargets = () => page.locator('.rb-joints__table tbody td:nth-child(3)').allInnerTexts();
  const first = await readTargets();
  await settle(1500);
  const second = await readTargets();
  console.log(`  targets: ${first.join(' ')} -> ${second.join(' ')}`);
  if (first.join() === second.join() && !CORE) console.log('  (targets did not change over 1.5 s; the sample glove may be holding a pose)');
  const thumb = await fidelityOf('Thumb');
  const ring = await fidelityOf('Ring');
  console.log(`  fidelity: ${thumb}; ${ring}`);
  if (!/100 percent/.test(thumb)) throw new Error(`thumb fidelity should read 100 percent, got "${thumb}"`);
  if (!/no ring finger/.test(ring)) throw new Error(`ring finger should be marked missing, got "${ring}"`);
  // The skinned hand and the robot's capsules take a moment on the software renderer.
  await settle(2500);
  await shot('01-screen');

  step('lesson source, then off: the state line follows the engine');
  await page.getByRole('radio', { name: 'Lesson' }).click();
  await page.waitForFunction(() => /lesson|Lesson/.test(document.querySelector('.rb-state')?.textContent ?? ''), null, { timeout: 20000 });
  console.log(`  state: ${await stateText()}`);
  await page.getByRole('radio', { name: 'Off' }).click();
  await page.waitForFunction(() => /The robot rests/.test(document.querySelector('.rb-state')?.textContent ?? ''), null, { timeout: 20000 });
  console.log(`  state: ${await stateText()}`);
  await settle(1500);
  await shot('02-off');
  await page.getByRole('radio', { name: 'Apprentice glove' }).click();
  await page.waitForFunction(() => /Following the apprentice glove/.test(document.querySelector('.rb-state')?.textContent ?? ''), null, { timeout: 20000 });

  step('training room: the practice stage is the expert and you only; the robot hand is one link away');
  await page.goto(`${BASE}/apprentice/lessons/seed-table-tennis/steps/0?mock=1`);
  await expectVisible(page.getByRole('button', { name: /Try it out|Start with the strings/ }), 'Try it out button');
  if (await page.locator('.ap-stage__canvas--robot').count()) throw new Error('the robot twin no longer sits in the training room');
  await page.getByText('Room settings').click();
  await expectVisible(page.getByRole('link', { name: 'open the robot hand' }), 'link to the robot screen');
  await settle(2000);
  await shot('03-room');

  step('expert studio: the robot fold under the live stage');
  await page.goto(`${BASE}/expert/scratch?mock=1`);
  await page.getByRole('button', { name: /shakehand grip/i }).click();
  await expectVisible(page.locator('.rb-studio summary'), 'robot fold summary');
  console.log(`  studio summary: ${await page.locator('.rb-studio summary').first().innerText()}`);
  if (!(await page.locator('.rb-studio').first().evaluate((el) => el.open))) await page.locator('.rb-studio summary').click();
  await expectVisible(page.locator('.rb-twin--studio'), 'studio twin');
  await settle(3000);
  await shot('04-studio');
} catch (e) {
  problems.push(`walk failed: ${e.message}`);
  await shot('zz-failure').catch(() => undefined);
}

if (problems.length) {
  exitCode = 1;
  console.error('\nProblems:');
  for (const p of problems) console.error(`  ${p}`);
} else console.log('\nRobot walk OK');

await browser.close();
if (vite) vite.kill();
process.exit(exitCode);
