// Smoke test: visits every route in a real (software-rendered) Chrome and fails on uncaught page errors or console errors.
// Run: npm run e2e   (backend on :8000 must be up; the dev server on :5176 is started here if not already running).
// Playwright is taken from the repo's genui package, so no extra dependency is added to the frontend.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, '../../genui/node_modules/playwright'));

const PORT = 5176;
const BASE = `http://localhost:${PORT}`;
const API = 'http://localhost:8000';
/** Console errors that are expected: a fresh install has no calibration yet. */
const ALLOWED = [/\/api\/calibrations\/latest/];

async function up(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await up(url)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

if (!(await up(`${API}/api/health`))) {
  console.error(`Backend is not running at ${API}. Start it with: cd backend && uv run uvicorn app.main:app --port 8000`);
  process.exit(2);
}

let vite = null;
if (!(await up(BASE))) {
  const bin = path.resolve(here, '../node_modules/vite/bin/vite.js');
  vite = spawn(process.execPath, [bin, '--port', String(PORT), '--strictPort'], { cwd: path.resolve(here, '..'), stdio: 'ignore' });
  if (!(await waitFor(BASE, 60000))) {
    vite.kill();
    console.error('Dev server did not start');
    process.exit(2);
  }
}

const lessons = await (await fetch(`${API}/api/lessons`)).json();
const seeds = lessons.filter((l) => l.source === 'seed' && l.steps.length);
if (!seeds.length) {
  vite?.kill();
  console.error('No lessons available to visit');
  process.exit(2);
}

const routes = [
  '/',
  '/master',
  '/master/scratch',
  '/master/generate',
  '/apprentice',
  ...[...new Set(seeds.map((seed) => seed.skill))].map((skill) => `/apprentice/skills/${skill}`),
  '/apprentice/skills/shadow_puppets',
  ...seeds.flatMap((seed) => [`/apprentice/lessons/${seed.id}`, `/apprentice/lessons/${seed.id}/steps/0`, `/apprentice/lessons/${seed.id}/test`]),
  '/lab',
];

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const failures = [];
try {
  for (const route of routes) {
    const page = await browser.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = `${m.text()} ${m.location()?.url ?? ''}`;
      if (ALLOWED.some((re) => re.test(text))) return;
      problems.push(`console.error: ${m.text()}`);
    });
    const resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
    // The app shell must render something (a heading or the root content), not a blank page.
    await page.locator('#root > *').first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => problems.push('root never rendered'));
    // Let data loads, the 3D scene and a few frames run so late errors surface.
    await page.waitForLoadState('load');
    await page.waitForFunction(() => document.querySelector('canvas') !== null || document.body.innerText.trim().length > 20, null, { timeout: 15000 }).catch(() => problems.push('page stayed empty'));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    if (!resp || !resp.ok()) problems.push(`HTTP ${resp?.status()}`);
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${route}`);
    for (const p of problems) console.log(`       ${p}`);
    if (problems.length) failures.push({ route, problems });
    await page.close();
  }
  // Through the dashboard: a live skill card opens its skill page, whose primary action opens the training room.
  {
    const page = await browser.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    try {
      await page.goto(`${BASE}/apprentice`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('searchbox').fill('forehand');
      await page.getByRole('link', { name: /Table tennis/ }).first().click();
      const start = page.getByRole('link', { name: /^(Start|Continue|Review) lesson \d+$/ });
      await start.waitFor({ state: 'visible', timeout: 15000 });
      await start.click();
      await page.waitForURL(/\/apprentice\/lessons\/[^/]+\/steps\/\d+$/, { timeout: 15000 });
    } catch (e) {
      problems.push(`dashboard click-through: ${e.message.split('\n')[0]}`);
    }
    console.log(`${problems.length ? 'FAIL' : 'ok  '} dashboard -> skill page -> training room`);
    for (const p of problems) console.log(`       ${p}`);
    if (problems.length) failures.push({ route: 'dashboard click-through', problems });
    await page.close();
  }
} finally {
  await browser.close();
  vite?.kill();
}

console.log(`\n${routes.length + 1 - failures.length}/${routes.length + 1} checks clean (routes plus the dashboard click-through)`);
process.exit(failures.length ? 1 : 0);
