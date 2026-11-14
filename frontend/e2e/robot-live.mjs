// Checks the robot screen against a live core (python -m core --fake on :8765; no backend needed): the connection
// line names the core and its model, holding Engage sends set_robot_source and the core's robot messages move the twin,
// releasing sends off. Screenshot: docs/screens/robot-07-live-core.png.
// Run: node e2e/robot-live.mjs   (starts Vite on :5185 if nothing answers; E2E_PORT picks the port).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, '../../genui/node_modules/playwright'));

const PORT = Number(process.env.E2E_PORT ?? 5185);
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(here, '../docs/screens') + path.sep;
const up = async (url) => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};
if (!(await up('http://localhost:8765/health'))) {
  console.error('No core on :8765. Start it with: python -m core --fake');
  process.exit(2);
}
let vite = null;
if (!(await up(BASE))) {
  const bin = path.resolve(here, '../node_modules/vite/bin/vite.js');
  vite = spawn(process.execPath, [bin, '--port', String(PORT), '--strictPort'], { cwd: path.resolve(here, '..'), stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up(BASE)); i++) await new Promise((r) => setTimeout(r, 300));
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const sent = [];
let robotMsgs = 0;
page.on('websocket', (ws) => {
  if (!ws.url().endsWith('/ws/robot')) return;
  ws.on('framesent', (f) => sent.push(String(f.payload)));
  ws.on('framereceived', (f) => {
    if (String(f.payload).includes('"type":"robot"')) robotMsgs += 1;
  });
});
let code = 0;
try {
  // ?mock=0 clears a remembered mock flag; with no backend the API part goes to mock on its own, the robot does not.
  await page.goto(`${BASE}/robot?mock=0`);
  await page.getByText(/^Core reachable at localhost:8765.*Unitree Dex3-1 loaded: 7 joints/).waitFor({ timeout: 20000 });
  const engage = page.getByRole('button', { name: /Hold to engage|Engaged/ });
  const box = await engage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.getByText(/^Engaged: the robot follows your hand\.$/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}robot-07-live-core.png`, fullPage: true });
  const before = robotMsgs;
  if (before < 10) throw new Error(`expected robot messages from the core while engaged, got ${before}`);
  await page.mouse.up();
  await page.getByText('Released: the robot holds still.').waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  const after = robotMsgs;
  await page.waitForTimeout(800);
  if (robotMsgs - after > 2) throw new Error('the core kept sending robot messages after release');
  const cmds = sent.map((s) => JSON.parse(s)).filter((m) => m.name === 'set_robot_source').map((m) => m.args.source);
  if (!cmds.includes('off') || !cmds.some((s) => s === 'master' || s === 'learner')) throw new Error(`unexpected commands: ${cmds.join(', ')}`);
  console.log(`live core check passed: ${before} robot messages while engaged, commands ${cmds.join(' -> ')}`);
} catch (e) {
  code = 1;
  console.error(`FAILED: ${e.message}`);
  await page.screenshot({ path: `${OUT}robot-zz-failure.png` }).catch(() => undefined);
} finally {
  await browser.close();
  if (vite) vite.kill();
  process.exit(code);
}
