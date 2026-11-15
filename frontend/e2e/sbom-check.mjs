#!/usr/bin/env node
/**
 * Checks the "What's in this site" page of a finished tour site (CRACI only). Usage: node e2e/sbom-check.mjs <site> <out>
 * Opens /sbom.html at phone size and asserts that the numbers on the page equal the numbers in sbom.cdx.json (counted
 * the same way as scripts/tour/fetch-sbom.mjs), or that the page says "No data" when the site has no SBOM. Fails on
 * console errors and on any request that leaves the page's origin. Saves a screenshot.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { SEVERITIES, summarise } from '../scripts/tour/fetch-sbom.mjs';

const site = resolve(process.argv[2] ?? 'dist-tour');
const out = resolve(process.argv[3] ?? 'sbom-check');
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
const summary = JSON.parse(readFileSync(join(site, 'sbom-summary.json'), 'utf8'));
const sbomPath = join(site, 'sbom.cdx.json');
const doc = existsSync(sbomPath) ? JSON.parse(readFileSync(sbomPath, 'utf8')) : null;
const truth = doc ? summarise(doc) : null;
// The page's package count must be the number of components in the published file, counted here independently.
if (doc && truth.components !== (doc.components ?? []).length + (doc.components ?? []).reduce((n, c) => n + countNested(c), 0))
  problems.push('the summary count differs from the components in sbom.cdx.json');
function countNested(c) {
  return (c.components ?? []).reduce((n, k) => n + 1 + countNested(k), 0);
}
if (truth && (truth.components !== summary.components || JSON.stringify(truth.vulnerabilities) !== JSON.stringify(summary.vulnerabilities)))
  problems.push('sbom-summary.json does not match sbom.cdx.json');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
page.on('console', (m) => m.type() === 'error' && problems.push(`console error: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('request', (r) => !r.url().startsWith(origin) && problems.push(`request left the origin: ${r.url()}`));
await page.goto(`${origin}/sbom.html`);
await page.waitForFunction(() => document.getElementById('state')?.hasAttribute('data-status'));
const shown = await page.evaluate(() => ({
  status: document.getElementById('state').getAttribute('data-status'),
  components: document.getElementById('components').textContent,
  cells: Object.fromEntries([...document.querySelectorAll('[data-severity]')].map((c) => [c.getAttribute('data-severity'), c.textContent])),
  download: document.querySelector('#download a')?.getAttribute('href') ?? null,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
}));
await page.screenshot({ path: join(out, 'phone-sbom.png'), fullPage: true });
await browser.close();
server.close();

if (shown.overflow) problems.push('the page overflows sideways at 390 px');
if (shown.status !== summary.status) problems.push(`status on the page ${shown.status}, in the summary ${summary.status}`);
if (truth) {
  const inFile = String((doc.components ?? []).length + (doc.components ?? []).reduce((n, c) => n + countNested(c), 0));
  if (shown.components !== inFile) problems.push(`packages on the page ${shown.components}, components in the file ${inFile}`);
  if (shown.components !== String(truth.components)) problems.push(`packages on the page ${shown.components}, in the SBOM ${truth.components}`);
  for (const s of SEVERITIES) {
    const want = truth.vulnerabilities ? String(truth.vulnerabilities[s]) : 'No data';
    if (shown.cells[s] !== want) problems.push(`${s} on the page ${shown.cells[s]}, in the SBOM ${want}`);
  }
  if (shown.download !== './sbom.cdx.json') problems.push('no download link for the SBOM');
} else {
  if (shown.components !== 'No data') problems.push(`no SBOM, but the page shows ${shown.components} packages`);
  for (const s of SEVERITIES) if (shown.cells[s] !== 'No data') problems.push(`no SBOM, but the page shows ${shown.cells[s]} for ${s}`);
}
console.log(JSON.stringify({ summary: { status: summary.status, components: summary.components, vulnerabilities: summary.vulnerabilities }, shown }, null, 1));
for (const p of problems) console.log(`PROBLEM ${p}`);
if (problems.length) process.exit(1);
console.log('sbom-check: passed');
