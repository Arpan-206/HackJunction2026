#!/usr/bin/env node
/**
 * Browser check of the tour's explore mode (CRACI only). Usage: node e2e/explore-check.mjs <site dir> <out dir>
 * Serves the site at the root, opens explore.html at phone and desktop size and walks: the landing page, the learner's
 * dashboard, a lesson, one practice rep with simulated hands to a score, the robot screen, the expert home, Settings
 * and a hardware-only screen. Fails on any request off the origin, any console error, any 404, the badge missing, and
 * any text that names Gemini or Gemma or says text was written by the AI Assistant. Saves screenshots and timings.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const site = resolve(process.argv[2] ?? 'dist-tour');
const out = resolve(process.argv[3] ?? 'explore-check');
mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream', '.urdf': 'application/xml', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  let p = normalize(join(site, decodeURIComponent(path)));
  if (!p.startsWith(site)) return res.writeHead(403).end();
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[extname(p)] ?? 'application/octet-stream' });
  createReadStream(p).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;
const problems = [];
const metrics = {};
const FORBIDDEN_TEXT = [/gemini/i, /gemma/i, /verda/i, /written by the AI Assistant/i, /read by the AI Assistant/i];

async function walk(tag, viewport, mobile) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`${tag}: console error: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`${tag}: page error: ${e.message}`));
  page.on('request', (r) => {
    const u = r.url();
    if (!(u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:'))) problems.push(`${tag}: request left the origin: ${u}`);
  });
  page.on('response', (r) => r.status() >= 400 && problems.push(`${tag}: HTTP ${r.status()} for ${r.url()}`));
  const shot = (name) => page.screenshot({ path: join(out, `${tag}-${name}.png`), fullPage: true });
  const textCheck = async (where) => {
    const text = await page.locator('body').innerText();
    for (const re of FORBIDDEN_TEXT) if (re.test(text)) problems.push(`${tag}: ${where} shows forbidden text ${re}`);
    if (!text.includes('Demo without gloves')) problems.push(`${tag}: ${where} has no explore badge`);
  };
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      problems.push(`${tag}: ${name}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
      await shot(`${name}-failed`).catch(() => {});
    }
  };

  const t0 = Date.now();
  await page.goto(`${origin}/explore.html#/apprentice`);
  await page.waitForFunction(() => window.__apprenticeMock === true, null, { timeout: 30000 }).catch(() => problems.push(`${tag}: mock backend not installed`));
  await page.getByRole('link', { name: /Shadow puppets/ }).first().waitFor({ timeout: 60000 }).catch(() => problems.push(`${tag}: dashboard did not show`));
  metrics[tag] = { exploreDashboardMs: Date.now() - t0 };
  await page.waitForTimeout(1500);
  await shot('dashboard');
  await textCheck('dashboard');

  await step('lesson', async () => {
    await page.goto(`${origin}/explore.html#/apprentice/lessons/seed-shadow-puppets`);
    await page.waitForTimeout(2500);
    await shot('lesson');
    await textCheck('lesson');
  });
  await step('practice', async () => {
    await page.goto(`${origin}/explore.html#/apprentice/lessons/seed-table-tennis/steps/2`);
    await page.getByRole('button', { name: /Try it out/ }).first().click({ timeout: 60000 });
    await page.getByRole('button', { name: /Begin (rep|attempt) 1/ }).first().click({ timeout: 30000 });
    await page.getByRole('region', { name: /Score for (attempt|rep) 1/ }).first().waitFor({ timeout: 90000 });
    await page.waitForTimeout(2500);
    await shot('score');
    await textCheck('score card');
  });
  await step('robot', async () => {
    await page.goto(`${origin}/explore.html#/robot`);
    await page.waitForTimeout(4000);
    await shot('robot');
    await textCheck('robot');
  });
  await step('expert', async () => {
    await page.goto(`${origin}/explore.html#/expert`);
    await page.waitForTimeout(3000);
    await shot('expert');
    await textCheck('expert home');
  });
  await step('settings', async () => {
    await page.getByRole('button', { name: 'Settings' }).first().click({ timeout: 15000 });
    await page.getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 10000 });
    await shot('settings');
    await textCheck('settings');
    await page.keyboard.press('Escape');
  });
  await step('gloves', async () => {
    await page.goto(`${origin}/explore.html#/gloves`);
    await page.getByRole('heading', { name: 'Not in this demo' }).waitFor({ timeout: 10000 });
    await shot('gloves');
  });
  await browser.close();
}

/**
 * One more try for a walk whose only problems are timeouts. The CRACI runner has no GPU and draws the 3D screens in
 * software, so a rep or a full-page screenshot is sometimes slower than its limit (runs of 15 Nov, 05:24 and 05:46 UTC:
 * one timeout each, on a different screen, in the phone walk at twice the pixel density). Any other problem (a request
 * off the origin, a console error, a 404, forbidden text, no badge) fails at once, and a second timeout fails too.
 */
const TIMEOUT = /Timeout \d+ms exceeded/;
const retried = [];
async function walkWithRetry(tag, viewport, mobile) {
  const before = problems.length;
  await walk(tag, viewport, mobile);
  const mine = problems.slice(before);
  if (!mine.length || !mine.every((p) => TIMEOUT.test(p))) return;
  console.log(`RETRY ${tag}: only timeouts in the first walk (${mine.join(' | ')}), walking once more`);
  retried.push({ tag, first: mine });
  problems.length = before;
  await walk(tag, viewport, mobile);
}

try {
  await walkWithRetry('desktop', { width: 1280, height: 900 }, false);
  await walkWithRetry('phone', { width: 390, height: 844 }, true);
} catch (e) {
  problems.push(`check crashed: ${e instanceof Error ? e.stack : String(e)}`);
}
server.close();
writeFileSync(join(out, 'metrics.json'), JSON.stringify({ metrics, problems, retried }, null, 2));
console.log(JSON.stringify(metrics));
for (const p of problems) console.log(`PROBLEM ${p}`);
if (problems.length) {
  console.log(`explore-check: FAILED with ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('explore-check: passed');
