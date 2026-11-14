// Walks /typing: types the first two drills with real key presses and checks the screen's lines and tally.
// Two modes:
//   node e2e/typing-walk.mjs                  no core: keys are checked, fingers are not.
//   TYPING_CORE=1 node e2e/typing-walk.mjs    against python -m core --fake on TYPING_CORE_PORT (default 8765): the core
//                                             simulates presses, so finger verdicts (good, wrong finger, unclear) appear.
// Fails on any uncaught page error. Screenshots go to docs/screens/typing-*.png.
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
const CORE = process.env.TYPING_CORE === '1';
const CORE_PORT = Number(process.env.TYPING_CORE_PORT ?? 8765);
// Without a core, point the socket at a closed port so the walk never switches the task of a core that happens to run.
const CORE_WS = CORE ? `ws://localhost:${CORE_PORT}/ws` : 'ws://localhost:9/ws';
const tag = CORE ? 'core' : 'nocore';

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
  vite = spawn(process.execPath, [bin, '--port', String(PORT), '--strictPort'], { cwd: path.resolve(here, '..'), stdio: 'ignore', env: { ...process.env, VITE_CORE_WS: CORE_WS } });
  for (let i = 0; i < 100 && !(await up(BASE)); i++) await new Promise((r) => setTimeout(r, 300));
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
const step = (msg) => console.log(`- ${msg}`);
const lineText = () => page.locator('.ty-line').innerText();

async function typeDrill(text, gapMs) {
  for (const ch of text) {
    await page.keyboard.press(ch === ' ' ? 'Space' : ch);
    await page.waitForTimeout(gapMs);
  }
}

let exitCode = 0;
try {
  step('/typing loads with the keyboard, the drill list and the tally');
  await page.goto(`${BASE}/typing?mock=1`);
  await page.getByRole('heading', { name: 'Touch typing' }).waitFor({ timeout: 20000 });
  await page.locator('.ty-kb').waitFor();
  if (CORE) await page.waitForFunction(() => /imagines each press|watching your fingers/.test(document.querySelector('.ty-engine')?.textContent ?? ''), null, { timeout: 20000 });
  console.log(`  engine: ${await page.locator('.ty-engine').innerText()}`);
  await page.screenshot({ path: `${OUT}typing-${tag}-01-start.png` });

  step('a wrong key: the cursor stays and the line says which key to type');
  await page.keyboard.press('g');
  await page.waitForTimeout(300);
  console.log(`  line: ${await lineText()}`);
  if (!/That was G\. Type F with your left index finger\./.test(await lineText())) throw new Error('wrong-key line missing');

  step('type the first drill');
  const drill1 = await page.locator('.ty-text').innerText();
  await typeDrill(drill1.replace(/ /g, ' '), CORE ? 380 : 40);
  await page.waitForTimeout(600);
  console.log(`  line: ${await lineText()}`);
  if (!/^Done\./.test(await lineText())) throw new Error('drill did not finish');
  const rows = await page.locator('.ty-tally tbody tr').allInnerTexts();
  console.log(`  tally:\n    ${rows.map((r) => r.replace(/\s+/g, ' ')).join('\n    ')}`);
  await page.screenshot({ path: `${OUT}typing-${tag}-02-done.png` });

  step('next drill, then a few keys mid-drill');
  await page.getByRole('button', { name: 'Next drill' }).click();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await typeDrill('ddd kk', CORE ? 380 : 40);
  await page.waitForTimeout(600);
  console.log(`  line: ${await lineText()}`);
  await page.screenshot({ path: `${OUT}typing-${tag}-03-mid.png` });
  if (problems.length) throw new Error(problems.join('\n'));
  console.log('OK');
} catch (e) {
  console.error(e.message ?? e);
  exitCode = 1;
} finally {
  await browser.close();
  vite?.kill();
}
process.exit(exitCode);
