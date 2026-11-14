// Captures the round 3 design frames (/design/<id>?freeze=1) as PNGs. No backend needed.
// Run: node e2e/design-shots.mjs <outDir> [id-filter]   (starts Vite on :5183 if nothing answers there).
// Playwright is taken from the repo's genui package, so no extra dependency is added to the frontend.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pwPaths = [path.resolve(here, '../../genui/node_modules/playwright'), path.resolve(here, '../../../../../genui/node_modules/playwright')];
const { chromium } = require(pwPaths.find((p) => fs.existsSync(p)) ?? pwPaths[0]);

const PORT = 5183;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.argv[2] ?? path.resolve(here, '../docs/screens/design'));
const FILTER = process.argv[3] ?? '';
fs.mkdirSync(OUT, { recursive: true });

/** id, query, file name, viewport. */
const SHOTS = [
  ['expert-setup', '', 'r3-1a-expert-setup', 'd'],
  ['expert-recording', '', 'r3-1b-expert-recording', 'd'],
  ['expert-review', '', 'r3-1c-expert-review', 'd'],
  ['learner-home', '', 'r3-2a-dashboard', 'd'],
  ['learner-home', '&q=pia', 'r3-2b-search', 'd'],
  ['learner-home', '&q=juggling', 'r3-2c-no-results', 'd'],
  ['skill-page', '', 'r3-2d-skill-page', 'd'],
  ['room-watch', '', 'r3-3a-watch', 'd'],
  ['room-handoff', '&m=1', 'r3-3b-handoff-1', 'd'],
  ['room-handoff', '&m=2', 'r3-3b-handoff-2', 'd'],
  ['room-handoff', '&m=3', 'r3-3b-handoff-3', 'd'],
  ['room-ghost', '', 'r3-3c-ghost', 'd'],
  ['room-blind', '', 'r3-3d-blind', 'd'],
  ['score-rep', '', 'r3-4a-score', 'd'],
  ['score-learned', '', 'r3-4b-learned', 'd'],
  ['expert-score', '', 'r3-4c-expert-score', 'd'],
  ['test-match', '', 'r3-5a-match', 'd'],
  ['test-diagnostics', '', 'r3-5b-diagnostics', 'd'],
  ['learner-home', '', 'r3-2a-dashboard-390', 'm'],
  ['room-ghost', '', 'r3-3c-ghost-390', 'm'],
  ['turntable', '', 'r3-turntable', 't'],
];
const VIEW = { d: { width: 1440, height: 900 }, m: { width: 390, height: 844 }, t: { width: 720, height: 520 } };

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
try {
  for (const [id, query, name, vp] of SHOTS) {
    if (FILTER && !name.includes(FILTER)) continue;
    const page = await browser.newPage({ viewport: VIEW[vp], deviceScaleFactor: 1 });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
    });
    await page.goto(`${BASE}/design/${id}?freeze=1&mock=1${query}`);
    await page.locator('canvas').first().waitFor({ state: 'attached', timeout: 30000 }).catch(() => undefined);
    // Skill cards render their stills one by one from a shared canvas; wait until that canvas is gone.
    await page.waitForFunction(() => !document.querySelector('[data-stills="wait"]'), null, { timeout: 90000 }).catch(() => undefined);
    await page.waitForTimeout(vp === 'm' ? 5000 : 6500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`${problems.length ? 'WARN' : 'ok  '} ${name}${problems.length ? `\n     ${problems.slice(0, 3).join('\n     ')}` : ''}`);
    if (problems.length) failed += 1;
    await page.close();
  }
} finally {
  await browser.close();
  if (vite) vite.kill();
}
process.exit(failed ? 1 : 0);
