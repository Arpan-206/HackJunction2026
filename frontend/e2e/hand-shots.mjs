// Captures the 3D hand for visual review: every held pose of the hand lab's Anatomy tab and the design frames that
// show hands. No backend needed. Run: node e2e/hand-shots.mjs <outDir> [prefix]   (starts Vite on :5193, or HAND_SHOTS_PORT, if needed).
// Playwright is taken from the repo's genui package, so no extra dependency is added to the frontend.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pwPaths = [process.env.PLAYWRIGHT_DIR ?? '', path.resolve(here, '../../genui/node_modules/playwright'), path.resolve(here, '../../../../../genui/node_modules/playwright')].filter(Boolean);
const { chromium } = require(pwPaths.find((p) => fs.existsSync(p)) ?? pwPaths[0]);

const PORT = Number(process.env.HAND_SHOTS_PORT ?? 5193);
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.argv[2] ?? path.resolve(here, 'shots'));
const PREFIX = process.argv[3] ?? 'hand';
const ONLY = process.argv[4] ?? '';
fs.mkdirSync(OUT, { recursive: true });

/** Design frames with hands: id, extra query, file suffix. */
const FRAMES = [
  ['turntable', '', 'turntable'],
  ['expert-review', '', 'expert-two-hands'],
  ['expert-recording', '', 'expert-racket'],
  ['room-ghost', '', 'room-ghost'],
  ['room-handoff', '&m=2', 'room-handoff'],
  ['score-rep', '', 'score-wood'],
  ['test-match', '', 'test-match'],
];

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
let failed = 0;
const watch = (page) => {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  return problems;
};
const report = (name, problems) => {
  console.log(`${problems.length ? 'WARN' : 'ok  '} ${name}${problems.length ? `\n     ${problems.slice(0, 3).join('\n     ')}` : ''}`);
  if (problems.length) failed += 1;
};
try {
  if (!ONLY || ONLY === 'lab') {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
    const problems = watch(page);
    await page.goto(`${BASE}/lab?tab=anatomy&mock=1`);
    await page.getByRole('tab', { name: 'Anatomy' }).click().catch(() => undefined);
    await page.locator('canvas').first().waitFor({ state: 'attached', timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(9000);
    const figs = page.locator('figure');
    const n = await figs.count();
    for (let i = 0; i < n; i++) {
      const fig = figs.nth(i);
      await fig.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const title = ((await fig.locator('figcaption').textContent()) ?? `cell-${i}`).replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '');
      await fig.screenshot({ path: path.join(OUT, `${PREFIX}-lab-${i + 1}-${title}.png`) });
    }
    report(`lab (${n} cells)`, problems);
    await page.close();
  }
  for (const [id, query, name] of FRAMES) {
    if (ONLY && ONLY !== name) continue;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const problems = watch(page);
    await page.goto(`${BASE}/design/${id}?freeze=1&mock=1${query}`);
    await page.locator('canvas').first().waitFor({ state: 'attached', timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(6500);
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-${name}.png`) });
    report(name, problems);
    await page.close();
  }
} finally {
  await browser.close();
  if (vite) vite.kill();
}
process.exit(failed ? 1 : 0);
