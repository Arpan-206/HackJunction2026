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
const FINGER_NAMES = ['Thumb', 'Index finger', 'Middle finger', 'Ring finger', 'Little finger'];

let exitCode = 0;
try {
  step('/robot: Copy me, the robot choice, the source switch and the finger sliders');
  // Mock mode is forced so the walk never depends on the Python backend; the robot endpoint is chosen by the store.
  await page.goto(`${BASE}/robot?mock=1`);
  await page.waitForFunction(() => window.__apprenticeMock === true, null, { timeout: 15000 });
  await expectVisible(page.getByRole('heading', { name: 'Robot hand' }), 'Robot hand heading');
  await expectVisible(page.getByRole('radiogroup', { name: 'Which robot' }), 'robot choice');
  for (const label of ['Three fingers', 'Five fingers']) await expectVisible(page.getByRole('radio', { name: label }), `${label} option`);
  await page.getByRole('radio', { name: 'Three fingers' }).click();
  // The engine (mock or core) answers with a hello; only then does the source switch appear.
  // (ROBOT_CORE=1 path: the same checks run against a real core's hello. Unverified here, no core could be run.)
  const source = page.getByRole('radiogroup', { name: 'Robot source' });
  await expectVisible(source, 'source switch once the engine answers');
  for (const label of ['Expert glove', 'Apprentice glove']) await expectVisible(source.getByRole('radio', { name: label }), `${label} option`);
  const sourceOptions = await source.getByRole('radio').count();
  if (sourceOptions !== 2) throw new Error(`Copy me should offer only the two gloves, saw ${sourceOptions} source options`);
  for (const gone of ['Lesson', 'Off']) {
    if (await source.getByRole('radio', { name: gone, exact: true }).count()) throw new Error(`Copy me should not offer the ${gone} source`);
  }

  step('the finger sliders: five labelled ranges, Ring and Little disabled on the three-finger robot');
  const listen = page.getByRole('group', { name: 'How closely each finger copies you' });
  await expectVisible(listen, 'finger copy fieldset');
  for (const name of FINGER_NAMES) await expectVisible(listen.getByRole('slider', { name, exact: true }), `${name} slider`);
  for (const name of ['Thumb', 'Index finger', 'Middle finger']) {
    if (await listen.getByRole('slider', { name, exact: true }).isDisabled()) throw new Error(`${name} slider should be enabled on the Dex3-1`);
  }
  for (const name of ['Ring finger', 'Little finger']) {
    if (!(await listen.getByRole('slider', { name, exact: true }).isDisabled())) throw new Error(`${name} slider should be disabled on the three-finger robot`);
  }
  const noFinger = await listen.getByText('No finger', { exact: true }).count();
  if (noFinger !== 2) throw new Error(`expected "No finger" on Ring and Little, saw ${noFinger}`);
  // Moving a slider changes its readout, and the reset button appears.
  const thumbSlider = listen.getByRole('slider', { name: 'Thumb', exact: true });
  await thumbSlider.focus();
  await page.keyboard.press('ArrowLeft');
  await expectVisible(page.getByRole('button', { name: 'Copy every finger fully' }), 'reset button after changing a finger');
  await page.getByRole('button', { name: 'Copy every finger fully' }).click();
  await expectVisible(listen.getByText('100%', { exact: true }), 'thumb back to 100%');

  step('apprentice glove stays selected and the twin draws');
  await source.getByRole('radio', { name: 'Apprentice glove' }).click();
  await expectVisible(source.getByRole('radio', { name: 'Apprentice glove', checked: true }), 'Apprentice glove selected');
  // The skinned hand and the robot's capsules take a moment on the software renderer.
  await settle(2500);
  await shot('01-screen');


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
