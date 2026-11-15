#!/usr/bin/env node
/**
 * Browser check of the built public tour (CRACI only; never on the demo laptop). Usage:
 *   node e2e/tour-check.mjs <dist-tour dir> <output dir>
 * Serves the build at the root (as Netlify does; TOUR_BASE=/sub/ for a sub-path), drives it with Playwright's
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
// Where the site is served: '/' as on Netlify (the default), or a sub-path such as /HackJunction2026/ as on GitHub Pages.
const BASE = process.env.TOUR_BASE ?? '/';
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
const warnings = [];
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
  // Long main-thread tasks during the load, to tell script work from network time.
  await page.addInitScript(() => {
    window.__long = [];
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true });
    } catch {
      /* no longtask support */
    }
  });
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
  await page.locator('.tour-title').waitFor({ timeout: 30000 });
  const tText = Date.now() - t0;
  // "First stop readable": the stop's own text and the stage's poster (or the no-WebGL still) are on screen.
  await page.locator('.tour-lead').first().waitFor({ timeout: 30000 });
  await page.waitForFunction(
    () => {
      const img = document.querySelector('.tour-stage__poster, .tour-stage__fallback img');
      return !!(img && img.complete && img.naturalWidth > 0) || !!document.querySelector('.tour-stage canvas') || !!document.querySelector('.tour-stage__fallback');
    },
    null,
    { timeout: 30000 },
  );
  const tReadable = Date.now() - t0;
  // "3D stage live": the hand has drawn its first frames (FirstFrame stamps data-stage-live, ms since navigation start).
  const live = await page.waitForFunction(() => document.body.dataset.stageLive, null, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);
  const tLive = live ? Number(live) : null;
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  const tIdle = Date.now() - t0;
  const resources = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((e) => ({ name: e.name.replace(location.origin, ''), start: Math.round(e.startTime), end: Math.round(e.responseEnd), bytes: e.encodedBodySize })),
  );
  const longTasks = await page.evaluate(() => window.__long);
  m.load = { domContentLoadedMs: tDom, firstTextMs: tText, firstStopReadableMs: tReadable, stageLiveMs: tLive, networkIdleMs: tIdle, bytesFirstLoad: bytesServed.n, longTasks, resources };
  metrics.runs[tag] = m;
  writeFileSync(join(out, 'metrics.json'), JSON.stringify(metrics, null, 2));
  await page.screenshot({ path: join(out, `${tag}-first-load.png`), fullPage: true });
  // The budget holds on what a visitor first sees: the stop readable within 5 s. The live 3D time is recorded.
  if (tReadable > 5000 && process.env.TOUR_BUDGET !== 'off') problems.push(`${tag}: first stop readable after ${tReadable} ms (budget 5000)`);
  if (tLive === null) problems.push(`${tag}: the 3D stage never drew a frame`);

  for (let i = 1; i <= STOPS; i++) {
    if (i > 1) await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForFunction((n) => location.hash === `#/${n}` || (n === 1 && location.hash === ''), i);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const badge = await page.locator('.tour-badge').innerText();
    if (!badge.includes('Recorded session, the live version uses Rokoko gloves')) problems.push(`${tag}: stop ${i} has no badge`);
    if (!(await page.locator('.tour-live').isVisible())) problems.push(`${tag}: stop ${i} has no live note`);
    if ((await page.getByRole('link', { name: "What's in this site" }).count()) !== 1) problems.push(`${tag}: stop ${i} has no "What's in this site" link`);
    await overflow(page, tag, i);
    // The stage alone, as a poster still for this stop.
    if (await page.locator('.tour-stage').count()) await page.locator('.tour-stage').first().screenshot({ path: join(out, `poster-${tag}-stop${i}.png`) });
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
  // Desktop first: the first page a freshly started headless browser opens pays the browser's own start-up work.
  await run('desktop', { width: 1280, height: 900 });
  await run('phone', { width: 390, height: 844 }, { throttle: true, mobile: true });
  // The same phone screen without Chrome's touch-device emulation, to tell an emulation artefact from the page's own load time.
  await run('phone-plain', { width: 390, height: 844 }, { throttle: true });
  await noWebGL();
} catch (e) {
  problems.push(`check crashed: ${e instanceof Error ? e.stack : String(e)}`);
}
server.close();
metrics.problems = problems;
metrics.warnings = warnings;
writeFileSync(join(out, 'metrics.json'), JSON.stringify(metrics, null, 2));
console.log(JSON.stringify({ load: Object.fromEntries(Object.entries(metrics.runs).map(([k, v]) => [k, v.load])) }, null, 2));
for (const w of warnings) console.log(`WARNING ${w}`);
for (const p of problems) console.log(`PROBLEM ${p}`);
if (problems.length) {
  console.log(`tour-check: FAILED with ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('tour-check: passed');
