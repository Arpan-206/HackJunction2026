// Proves the expert's work survives closing the tab and moving to a fresh browser, against the REAL backend (mock off):
// the gloves screen names the saved calibration, Record takes two real takes, the draft lands on the backend
// (GET /api/drafts/scratch/<id>), a new tab in the same browser and a brand new browser profile both open on
// "Carry on where you left off: 2 takes of Move 1 recorded." with both takes listed. Then the sample data notice in
// mock mode. Cleans up after itself: deletes its draft and its two takes, so the expert's own work is untouched.
// Its draft starts with a fresh savedAt so it never picks up a draft the expert has on the backend.
// Run (backend on :8000, Vite on E2E_PORT, default 5173): node e2e/persist-walk.mjs
// Screenshots: persist-<n>-<screen>.png in E2E_SHOTS (default docs/screens/persist).
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, '../../genui/node_modules/playwright'));

const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.env.E2E_SHOTS ?? path.resolve(here, '../docs/screens/persist'));
mkdirSync(OUT, { recursive: true });
const KEY = 'apprentice.scratch.draft.v2';
const DRAFT_ID = 'e2epersist01';
const log = (msg) => console.log(`- ${msg}`);
const api = async (method, p) => {
  const r = await fetch(`${BASE}/api${p}`, { method });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
};

const seed = {
  v: 2,
  id: DRAFT_ID,
  screen: 'record',
  current: { id: 'free_e2epers1', moveId: null, name: 'Move 1', description: "Follow the expert's hand, finger by finger.", skill: 'general', hands: 'right', prop: 'none', motion: null, repetitions: 3 },
  model: null,
  takeIds: {},
  moves: [],
  skill: 'general',
  skillLocked: false,
  skillName: null,
  about: '',
  masterName: '',
  savedAt: Date.now() + 60_000,
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const problems = [];
let takes = [];
// Every draft this walk's pages saved on the backend, deleted at the end.
const drafts = new Set([DRAFT_ID]);

async function open(context, url) {
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|404 \(Not Found\)/.test(m.text())) problems.push(`console.error: ${m.text()}`);
  });
  if (process.env.E2E_DEBUG) page.on('response', (r) => /\/api\/drafts/.test(r.url()) && console.log(`  ${r.request().method()} ${r.url()} ${r.status()}`));
  current = page;
  page.on('response', (r) => {
    const m = /\/api\/drafts\/scratch\/([^/?]+)$/.exec(r.url());
    if (m && r.request().method() === 'PUT' && !url.includes('mock=1')) drafts.add(decodeURIComponent(m[1]));
  });
  await page.goto(url);
  return page;
}
let current = null;
const see = async (locator, what, timeout = 20000) =>
  locator.first().waitFor({ state: 'visible', timeout }).catch(async () => {
    if (current) await current.screenshot({ path: path.join(OUT, 'persist-zz-failure.png') }).catch(() => undefined);
    throw new Error(`Expected to see: ${what}`);
  });
const shot = (page, n, name) => page.screenshot({ path: path.join(OUT, `persist-${n}-${name}.png`) });

try {
  const health = await api('GET', '/health');
  if (health.status !== 200) throw new Error('the real backend is not answering through Vite');
  log(`backend glove source: ${health.body.glove_source}`);

  log('the gloves screen names the saved calibration');
  let context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await open(context, `${BASE}/gloves?mock=0`);
  await page.waitForFunction(() => window.__apprenticeMock !== true, null, { timeout: 15000 });
  await see(page.getByText(/Using your calibration from|No calibration saved yet/), 'the calibration in use');
  await see(page.getByRole('link', { name: /Calibrate again|Calibrate gloves/ }), 'Calibrate again');
  await page.waitForTimeout(2500);
  await shot(page, 1, 'gloves');

  log('record two real takes');
  await page.evaluate(([k, d]) => window.localStorage.setItem(k, JSON.stringify(d)), [KEY, seed]);
  await page.goto(`${BASE}/expert/scratch?mock=0`);
  await see(page.getByRole('heading', { name: 'Record your move' }), 'the record screen');
  if (await page.getByText('Sample data mode').count()) throw new Error('the sample data notice must not show with the backend on');
  if (await page.getByRole('group', { name: 'Hands' }).count()) await page.getByRole('group', { name: 'Hands' }).getByRole('button', { name: 'Right hand' }).click();
  for (let n = 1; n <= 2; n++) {
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Record a take' }).click();
    await see(page.getByRole('button', { name: /^Stop/ }), `Stop for take ${n}`, 30000);
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: /^Stop/ }).click();
    await see(page.getByRole('button', { name: `Delete take ${n}` }), `take ${n} in the strip`);
  }
  await page.waitForTimeout(1500);
  await shot(page, 2, 'record-2-takes');
  const onDisk = await api('GET', `/drafts/scratch/${DRAFT_ID}`);
  takes = Object.values(onDisk.body?.draft?.takeIds ?? {}).flat();
  if (onDisk.status !== 200 || takes.length !== 2) throw new Error(`the backend should hold the draft with 2 takes, has ${onDisk.status} ${JSON.stringify(onDisk.body).slice(0, 200)}`);
  for (const id of takes) {
    const rec = await api('GET', `/recordings/${id}`);
    const hands = rec.body?.frames?.reduce((n, f) => n + f.hands.length, 0) ?? 0;
    log(`take ${id}: ${rec.body?.frames?.length ?? 0} frames, ${hands} hand samples, ${rec.body?.duration_s}s`);
    if (!rec.body?.frames?.length) throw new Error(`take ${id} has no frames`);
  }
  log(`backend draft file data/drafts/${DRAFT_ID}.json holds takes ${takes.join(', ')}`);

  log('close the tab, open a new one in the same browser');
  await page.close();
  page = await open(context, `${BASE}/expert/scratch?mock=0`);
  await see(page.getByText('Carry on where you left off: 2 takes of Move 1 recorded.'), 'the resume note in a new tab');
  await see(page.getByRole('button', { name: 'Delete take 2' }), 'both takes listed again');
  await see(page.getByRole('button', { name: 'Start fresh' }), 'Start fresh');
  await page.waitForTimeout(1500);
  await shot(page, 3, 'resumed-new-tab');
  await page.close();
  await context.close();

  log('a brand new browser profile (another laptop): the draft comes from the backend');
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // A first visit with real gloves opens the gloves screen once (GloveStatusLine); go through it as a person would.
  page = await open(context, `${BASE}/gloves?mock=0`);
  await see(page.getByText(/Using your calibration from|No calibration saved yet/), 'the gloves screen in the new browser');
  await page.goto(`${BASE}/expert/scratch?mock=0`);
  await see(page.getByText('Carry on where you left off: 2 takes of Move 1 recorded.'), 'the resume note from the backend copy');
  await see(page.getByRole('button', { name: 'Delete take 2' }), 'both takes listed from the backend');
  const local = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? 'null'), KEY);
  if (local?.id !== DRAFT_ID) throw new Error(`the new browser should carry on the same draft, has ${local?.id}`);
  await page.waitForTimeout(1500);
  await shot(page, 4, 'resumed-new-browser');

  log('the studio offers Load from file and Back up everything');
  await page.goto(`${BASE}/expert?mock=0`);
  await see(page.getByRole('button', { name: 'Load from file' }), 'Load from file');
  await see(page.getByRole('button', { name: 'Back up everything' }), 'Back up everything');
  await page.getByRole('button', { name: 'Load from file' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await shot(page, 5, 'studio-files');
  await page.close();
  await context.close();

  log('mock mode says takes are not saved to disk');
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await open(context, `${BASE}/expert/scratch?mock=1`);
  await see(page.getByText('Sample data mode: takes are not saved to disk. Start the backend to keep them.'), 'the sample data notice');
  await page.waitForTimeout(1200);
  await shot(page, 6, 'mock-notice');
  await page.close();
  await context.close();
} finally {
  // Leave the expert's backend as it was: drop this walk's draft and takes.
  for (const id of drafts) await api('DELETE', `/drafts/scratch/${id}`).catch(() => undefined);
  for (const id of takes) await api('DELETE', `/recordings/${id}`).catch(() => undefined);
  await browser.close();
}

if (problems.length) {
  console.log(`Problems:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('persist walk passed');
