#!/usr/bin/env node
/**
 * Checks the "Boring stats for nerds" page of a built tour site (CRACI only). Usage: node e2e/stats-check.mjs <site> <out>
 * Opens /stats.html at phone size and asserts: it fits 390 px with no sideways scroll, text is at least 16 px, every
 * table names its source, it runs no script and asks nothing outside its origin, and both the tour footer and stop 3
 * link to it. Saves a screenshot.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const site = resolve(process.argv[2] ?? 'dist-tour');
const out = resolve(process.argv[3] ?? 'stats-check');
mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
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
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
page.on('console', (m) => m.type() === 'error' && problems.push(`console error: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
const requests = [];
page.on('request', (r) => {
  requests.push(r.url());
  if (!r.url().startsWith(origin)) problems.push(`request left the origin: ${r.url()}`);
});
await page.goto(`${origin}/stats.html`);
await page.waitForLoadState('load');
const shown = await page.evaluate(() => ({
  title: document.querySelector('h1')?.textContent ?? '',
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  tables: document.querySelectorAll('table').length,
  unsourced: [...document.querySelectorAll('table')].filter((t) => !/Sources?: \S/.test(t.querySelector('caption')?.textContent ?? '')).length,
  scripts: document.querySelectorAll('script').length,
  smallest: Math.min(...[...document.querySelectorAll('p, li, th, td, caption, a, h1, h2')].map((e) => parseFloat(getComputedStyle(e).fontSize))),
  back: [...document.querySelectorAll('a')].filter((a) => a.getAttribute('href') === './').length,
}));
await page.screenshot({ path: join(out, 'phone-stats.png'), fullPage: true });

// The tour links to the page from its footer on every stop, and from stop 3.
await page.goto(`${origin}/`);
await page.waitForSelector('.tour-site a');
const footer = await page.locator('.tour-site a[href="./stats.html"]').count();
await page.goto(`${origin}/#/3`);
await page.reload();
const stop = await page
  .waitForSelector('.tour-stop a[href="./stats.html"]', { timeout: 20000 })
  .then(() => page.locator('.tour-stop a[href="./stats.html"]').count())
  .catch(() => 0);
await browser.close();
server.close();

if (shown.title !== 'Boring stats for nerds') problems.push(`the heading reads "${shown.title}"`);
if (shown.overflow) problems.push('the page overflows sideways at 390 px');
if (shown.tables < 6) problems.push(`only ${shown.tables} tables`);
if (shown.unsourced) problems.push(`${shown.unsourced} tables name no source`);
if (shown.scripts) problems.push('the page runs a script');
if (shown.smallest < 16) problems.push(`text of ${shown.smallest} px, below 16 px`);
if (shown.back < 1) problems.push('no link back to the tour');
if (requests.some((u) => /\.(m?js)(\?|$)/.test(new URL(u).pathname) && u.includes('stats'))) problems.push('the page loaded a script file');
if (footer !== 1) problems.push(`the tour footer has ${footer} links to stats.html, expected 1`);
if (stop !== 1) problems.push(`stop 3 has ${stop} links to stats.html, expected 1`);
console.log(JSON.stringify({ shown, footer, stop }, null, 1));
for (const p of problems) console.log(`PROBLEM ${p}`);
if (problems.length) process.exit(1);
console.log('stats-check: passed');
