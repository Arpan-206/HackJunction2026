// End-to-end check: validate each spec, render it in headless Chromium, assert the components and the WebGL hand,
// and save screenshots to test/output/. Usage: node test/render.mjs [spec names...]  (default: piano table-tennis)
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { validateSpec } from '../validate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test', 'output');
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['piano', 'table-tennis'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([\\/])+/, '');
  const file = join(root, path);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
await mkdir(outDir, { recursive: true });

const launchArgs = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
// Prefer Playwright's own Chromium; fall back to the installed Google Chrome.
const browser = await chromium.launch(launchArgs).catch(() => chromium.launch({ ...launchArgs, channel: 'chrome' }));
let failed = 0;

for (const name of names) {
  const spec = JSON.parse(readFileSync(join(root, 'specs', `${name}.json`), 'utf8'));
  const problems = validateSpec(spec);
  const result = { name, valid: problems.length === 0, problems, errors: [] };
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => result.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') result.errors.push(m.text()); });
  await page.goto(`${base}/renderer/index.html?spec=${name}`);
  await page.waitForSelector(`#page[data-rendered]`, { timeout: 10000 });
  await page.waitForTimeout(2500);

  const expected = [...spec.main, ...spec.side].map((c) => c.type);
  const rendered = await page.$$eval('#page [data-component]', (ns) => ns.map((n) => n.getAttribute('data-component')).filter((t, i, a) => !(t === 'hand_stage' && a.indexOf(t) !== i)));
  // Count non-background pixels in the WebGL canvas to prove the hand actually drew.
  const inked = await page.$eval('.stage canvas', (c) => {
    const probe = document.createElement('canvas');
    probe.width = 200; probe.height = 140;
    const ctx = probe.getContext('2d');
    ctx.drawImage(c, 0, 0, 200, 140);
    const d = ctx.getImageData(0, 0, 200, 140).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) n++;
    return n / (200 * 140);
  });
  const unknown = await page.$$eval('#page .error', (ns) => ns.map((n) => n.textContent));
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });

  const sameComponents = JSON.stringify(expected) === JSON.stringify(rendered);
  const ok = result.valid && sameComponents && inked > 0.05 && unknown.length === 0 && result.errors.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  console.log(`  schema+rules: ${result.valid ? 'valid' : problems.join('; ')}`);
  console.log(`  components: ${rendered.length}/${expected.length} rendered in order${sameComponents ? '' : ` (expected ${expected.join(',')} got ${rendered.join(',')})`}`);
  console.log(`  3D hand canvas coverage: ${(inked * 100).toFixed(1)}% of pixels drawn`);
  if (unknown.length) console.log(`  error cards: ${unknown.join(' | ')}`);
  if (result.errors.length) console.log(`  page errors: ${result.errors.join(' | ')}`);
  console.log(`  screenshot: test/output/${name}.png`);
  await page.close();
}

// Negative control: a broken spec must be rejected by the validator.
const broken = JSON.parse(readFileSync(join(root, 'specs', `${names[0]}.json`), 'utf8'));
broken.main = broken.main.filter((c) => c.type !== 'hand_stage');
broken.side.push({ type: 'hologram', text: 'not in catalog' });
const caught = validateSpec(broken);
console.log(`${caught.length ? 'PASS' : 'FAIL'} negative control: validator rejected a broken spec with ${caught.length} problem(s)`);
if (!caught.length) failed++;

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
