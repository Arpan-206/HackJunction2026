#!/usr/bin/env node
/**
 * Browser check of the built public tour (CRACI only; never on the demo laptop). Usage:
 *   node e2e/tour-check.mjs <dist-tour dir> <output dir>
 * Serves the build under /HackJunction2026/ (as a GitHub Pages project site would), drives it with Playwright's
 * chromium at a phone viewport (390 x 844, throttled to a normal connection) and a desktop viewport, takes a screenshot
 * per stop, and fails on any console error, page error, failed request, horizontal overflow, or request that leaves the
 * page's own origin. It also checks a deep link reload, the teach stop's buttons, the clip, and the no-WebGL fallback.
 * Writes <output dir>/metrics.json.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const dist = resolve(process.argv[2] ?? 'dist-tour');
const out = resolve(process.argv[3] ?? 'tour-check');
mkdirSync(out, { recursive: true });
const BASE = '/HackJunction2026/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.glb': 'model/gltf-binary', '.urdf': 'application/xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.md': 'text/markdown' };

const bytesServed = { n: 0 };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith(BASE)) {
    res.writeHead(404).end();
    return;
  }
  let p = normalize(join(dist, decodeURIComponent(url.pathname.slice(BASE.length))));
  if (!p.startsWith(dist)) return res.writeHead(403).end();
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) return res.writeHead(404).end();
  const size = statSync(p).size;
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  const type = TYPES[extname(p)] ?? 'application/octet-stream';
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    bytesServed.n += end - start + 1;
    createReadStream(p, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  bytesServed.n += size;
  createReadStream(p).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;
const home = `${origin}${BASE}`;

const problems = [];
const metrics = { origin, runs: {} };
const STOPS = 5;

function watch(page, tag) {
  const seen = { requests: [], outside: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${tag}: console error: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`${tag}: page error: ${e.message}`));
  page.on('request', (r) => {
    const u = r.url();
    seen.requests.push(u);
    if (!(u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:'))) {
      seen.outside.push(u);
      problems.push(`${tag}: request left the origin: ${u}`);
    }
  });
  page.on('requestfailed', (r) => {
    // A video element cancels its own range requests when it seeks or pauses; that is not a failure.
    if (r.failure()?.errorText === 'net::ERR_ABORTED' && r.url().endsWith('.mp4')) return;
    problems.push(`${tag}: request failed: ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`${tag}: HTTP ${r.status()} for ${r.url()}`);
  });
  return seen;
}

async function overflow(page, tag, stop) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (o.sw > o.w + 1) problems.push(`${tag}: stop ${stop} overflows sideways (${o.sw} > ${o.w})`);
}

async function run(tag, viewport, { throttle = false, mobile = false } = {}) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await context.newPage();
  const seen = watch(page, tag);
  const m = { stops: [] };
  if (throttle) {
    // A normal connection: 10 Mbit/s down, 5 up, 40 ms round trip.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (10e6 / 8) | 0, uploadThroughput: (5e6 / 8) | 0 });
  }
  bytesServed.n = 0;
  const t0 = Date.now();
  await page.goto(home, { waitUntil: 'domcontentloaded' });
  const tDom = Date.now() - t0;
  await page.locator('.tour-stage canvas, .tour-stage__fallback').first().waitFor({ timeout: 30000 });
  const tStage = Date.now() - t0;
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  const tIdle = Date.now() - t0;
  m.load = { domContentLoadedMs: tDom, firstStageMs: tStage, networkIdleMs: tIdle, bytesFirstLoad: bytesServed.n };
  if (tStage > 5000) problems.push(`${tag}: first stop took ${tStage} ms to show its stage (budget 5000)`);

  for (let i = 1; i <= STOPS; i++) {
    if (i > 1) await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForFunction((n) => location.hash === `#/${n}`, i);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const badge = await page.locator('.tour-badge').innerText();
    if (!badge.includes('Recorded session, the live version uses Rokoko gloves')) problems.push(`${tag}: stop ${i} has no badge`);
    if (!(await page.locator('.tour-live').isVisible())) problems.push(`${tag}: stop ${i} has no live note`);
    await overflow(page, tag, i);
    const shot = join(out, `${tag}-stop${i}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    m.stops.push({ stop: i, screenshot: shot });

    if (i === 4) {
      // The clip: same origin, and it plays.
      await page.locator('video').evaluate((v) => {
        v.muted = true;
        return v.play();
      });
      await page.waitForTimeout(1500);
      const t = await page.locator('video').evaluate((v) => v.currentTime);
      if (!(t > 0)) problems.push(`${tag}: the push-recovery clip did not play`);
      await page.locator('video').evaluate((v) => v.pause());
    }
    if (i === 5) {
      const before = await page.locator('.tour-speech').innerText();
      await page.getByRole('button', { name: 'Nothing is wrong' }).click();
      await page.waitForTimeout(500);
      const after = await page.locator('.tour-speech').innerText();
      if (before === after) problems.push(`${tag}: teach stop did not answer "Nothing is wrong"`);
      await page.screenshot({ path: join(out, `${tag}-stop5-answered.png`), fullPage: true });
    }
  }
  // Back and the arrow keys.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.waitForFunction(() => location.hash === '#/4');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => location.hash === '#/3');
  // A deep link reload must not 404.
  await page.goto(`${home}#/2`);
  await page.reload();
  await page.locator('.tour-title').waitFor();
  const title = await page.locator('.tour-title').innerText();
  if (!title.includes('Stop 2')) problems.push(`${tag}: reload of #/2 showed "${title}"`);
  m.requests = seen.requests.length;
  m.outside = seen.outside;
  metrics.runs[tag] = m;
  await browser.close();
}

async function noWebGL() {
  const browser = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  watch(page, 'nowebgl');
  await page.goto(`${home}#/1`);
  await page.locator('.tour-stage__fallback').waitFor({ timeout: 15000 });
  await page.screenshot({ path: join(out, 'nowebgl-stop1.png'), fullPage: true });
  await browser.close();
}

try {
  await run('phone', { width: 390, height: 844 }, { throttle: true, mobile: true });
  await run('desktop', { width: 1280, height: 900 });
  await noWebGL();
} catch (e) {
  problems.push(`check crashed: ${e instanceof Error ? e.stack : String(e)}`);
}
server.close();
metrics.problems = problems;
writeFileSync(join(out, 'metrics.json'), JSON.stringify(metrics, null, 2));
console.log(JSON.stringify({ load: Object.fromEntries(Object.entries(metrics.runs).map(([k, v]) => [k, v.load])) }, null, 2));
for (const p of problems) console.log(`PROBLEM ${p}`);
if (problems.length) {
  console.log(`tour-check: FAILED with ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('tour-check: passed');
