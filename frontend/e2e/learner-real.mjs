// Real-backend learner check: with the backend on GLOVE_SOURCE=simulator and LLM_PROVIDER=fake (no mock, no gloves), a
// learner who simply follows the step must get every rep clean (within_tolerance and overall >= 80) on a held pose
// (table tennis grip), a swing (forehand) and a piano scale step. Captures every POST /api/score exchange.
// Run: node e2e/learner-real.mjs   (backend on :8000; the dev server on :5177 is started here if nothing answers there).
// Playwright is taken from the repo's genui package, so no extra dependency is added to the frontend.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, '../../genui/node_modules/playwright'));

const PORT = 5177;
const BASE = `http://localhost:${PORT}`;
const API = 'http://localhost:8000';
const REPS = Number(process.env.REPS ?? 2);
const CLEAN_OVERALL = 80;
const VERBOSE = process.env.VERBOSE === '1';

const up = async (url) => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};

const health = await fetch(`${API}/api/health`).then((r) => r.json()).catch(() => null);
if (!health) {
  console.error(`Backend is not running at ${API}.`);
  process.exit(2);
}
if (health.llm_provider !== 'fake' || health.glove_source !== 'simulator') {
  console.error(`Refusing to run: need llm_provider=fake and glove_source=simulator, got ${JSON.stringify(health)}`);
  process.exit(2);
}

let vite = null;
if (!(await up(BASE))) {
  const bin = path.resolve(here, '../node_modules/vite/bin/vite.js');
  vite = spawn(process.execPath, [bin, '--port', String(PORT), '--strictPort'], { cwd: path.resolve(here, '..'), stdio: 'ignore' });
  for (let i = 0; i < 200 && !(await up(BASE)); i++) await new Promise((r) => setTimeout(r, 300));
  if (!(await up(BASE))) {
    vite.kill();
    console.error('Dev server did not start');
    process.exit(2);
  }
}

const lessons = await (await fetch(`${API}/api/lessons`)).json();
const seed = (lessonId, stepId) => {
  const lesson = lessons.find((l) => l.id === lessonId);
  const index = lesson?.steps.findIndex((s) => s.id === stepId) ?? -1;
  if (index < 0) throw new Error(`seed step ${lessonId}/${stepId} not found`);
  return { lessonId, index, stepId };
};
const targets = [
  { label: 'hold (table tennis shakehand grip)', ...seed('seed-table-tennis', 'seed-tt-grip') },
  { label: 'moving (table tennis forehand swing)', ...seed('seed-table-tennis', 'seed-tt-forehand') },
  { label: 'moving (piano five-finger scale)', ...seed('seed-piano', 'seed-piano-scale') },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = [];
const problems = [];
try {
  for (const target of targets) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const exchanges = [];
    page.on('pageerror', (e) => problems.push(`${target.label}: pageerror ${e.message}`));
    page.on('response', async (resp) => {
      const req = resp.request();
      if (req.method() !== 'POST' || !new URL(req.url()).pathname.endsWith('/api/score')) return;
      const body = JSON.parse(req.postData() ?? '{}');
      const frames = body.attempt_frames ?? [];
      const result = await resp.json().catch(() => null);
      exchanges.push({
        status: resp.status(),
        side: body.side,
        reference_motion: body.reference_motion?.preset,
        frames: frames.length,
        t0: frames[0]?.t,
        tLast: frames.at(-1)?.t,
        maxGap: frames.reduce((m, f, i) => (i ? Math.max(m, f.t - frames[i - 1].t) : m), 0),
        calibrated: Boolean(body.use_latest_calibration),
        result,
      });
    });

    await page.goto(`${BASE}/apprentice/lessons/${target.lessonId}/steps/${target.index}`, { waitUntil: 'domcontentloaded' });
    // The first stage of a step can be the watch stage; skip it to reach scored reps.
    const strings = page.getByRole('button', { name: /Try it out|Start with the strings/ });
    const begin = page.getByRole('button', { name: /Begin (rep|attempt) \d+/ });
    await strings.or(begin).first().waitFor({ state: 'visible', timeout: 30000 });
    if (await strings.isVisible()) await strings.click();

    for (let rep = 1; rep <= REPS; rep++) {
      await begin.waitFor({ state: 'visible', timeout: 30000 });
      await begin.click();
      try {
        await page.getByRole('region', { name: /Score for (attempt|rep) \d+/ }).waitFor({ state: 'visible', timeout: 60000 });
      } catch {
        // No score appeared: typically the attempt was too short and was sent back to ready without scoring.
        const note = await page.locator('main').innerText().then((t) => t.split('\n').filter((l) => /not scored|too short|no glove/i.test(l)).join(' | ')).catch(() => '');
        problems.push(`${target.label}: rep ${rep} produced no score. ${note}`);
        continue;
      }
      const retry = page.getByRole('button', { name: 'Next rep' });
      if (rep < REPS) await retry.click();
    }
    report.push({ target, exchanges });
    await context.close();
  }
} finally {
  await browser.close();
  vite?.kill();
}

let failed = false;
for (const { target, exchanges } of report) {
  const real = exchanges.filter((e) => e.status === 200 && e.result);
  const clean = real.filter((e) => e.result.within_tolerance && e.result.overall >= CLEAN_OVERALL);
  console.log(`\n${target.label}: ${clean.length}/${real.length} clean reps (POST /api/score calls: ${exchanges.length})`);
  for (const e of real) {
    const r = e.result;
    const pf = Object.entries(r.per_finger).map(([k, v]) => `${k[0]}${v}`).join(' ');
    console.log(`  frames=${e.frames} maxGap=${e.maxGap.toFixed(2)} t=${e.t0}..${e.tLast?.toFixed?.(2)} side=${e.side} cal=${e.calibrated} overall=${r.overall} timing=${r.timing} within=${r.within_tolerance} per_finger[${pf}] hint="${r.hint}"`);
    if (VERBOSE) console.log(`  ${JSON.stringify(r)}`);
  }
  if (clean.length !== REPS) {
    failed = true;
    problems.push(`${target.label}: ${clean.length} of ${REPS} reps clean (${real.length} scored attempts)`);
  }
}
if (problems.length) {
  console.log('\nPROBLEMS');
  problems.forEach((p) => console.log(`  ${p}`));
}
process.exit(failed || problems.length ? 1 : 0);
