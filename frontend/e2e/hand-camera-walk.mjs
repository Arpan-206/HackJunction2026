// Walks the dev hand camera view: Dev panel button, orbit about half a turn, zoom, Copy camera, paste it back.
// Needs the dev server up (npm run dev; E2E_PORT picks the port, default 5173). No backend: runs with ?mock=1.
// Run: node e2e/hand-camera-walk.mjs [outDir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pwPaths = [process.env.PLAYWRIGHT_DIR ?? '', path.resolve(here, '../../genui/node_modules/playwright'), path.resolve(here, '../../../../../genui/node_modules/playwright')].filter(Boolean);
const { chromium } = require(pwPaths.find((p) => fs.existsSync(p)) ?? pwPaths[0]);

const BASE = `http://localhost:${process.env.E2E_PORT ?? 5173}`;
const OUT = path.resolve(process.argv[2] ?? path.resolve(here, 'shots'));
fs.mkdirSync(OUT, { recursive: true });

let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) failed++;
};
const json = (text) => JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => check(false, `page error: ${e.message}`));
  const copy = async () => {
    await page.getByRole('button', { name: 'Copy camera' }).click();
    await page.getByRole('status').filter({ hasText: 'Copied' }).waitFor({ timeout: 5000 });
    return page.evaluate(() => navigator.clipboard.readText());
  };

  await page.goto(`${BASE}/?mock=1&dev=1`);
  await page.locator('.role__stage canvas').first().waitFor({ timeout: 30000 });
  const card = await page.locator('.role__stage').first().boundingBox();
  console.log(`role card stage ${Math.round(card.width)} x ${Math.round(card.height)}, aspect ${(card.width / card.height).toFixed(3)}`);
  await page.getByRole('button', { name: 'Dev' }).click();
  const link = page.getByRole('link', { name: 'Hand camera view' });
  await link.waitFor();
  await page.screenshot({ path: path.join(OUT, 'handcam-1-devpanel.png') });
  await link.click();
  await page.waitForURL('**/dev/hand-camera');
  const stage = page.getByTestId('handcam-stage');
  await stage.locator('canvas').waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'handcam-2-default.png') });

  const a = json(await copy());
  console.log('default snapshot', JSON.stringify(a));
  check(Math.abs(a.azimuth - 20) < 0.5 && Math.abs(a.elevation - 55) < 0.5 && Math.abs(a.distance - 5.8) < 0.01, 'opens on the card camera (5.8, 20 deg, 55 deg)');

  // OrbitControls turns 2 pi * dx / height * rotateSpeed (0.8): half a turn is height / 1.6 pixels.
  const box = await stage.boundingBox();
  const dx = Math.round(box.height / 1.6);
  const x0 = box.x + box.width * 0.75;
  const y0 = box.y + box.height * 0.55;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(x0 - (dx * i) / 20, y0, { steps: 2 });
  await page.mouse.up();
  await page.mouse.move(x0 - dx, y0);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, 'handcam-3-orbited.png') });

  const text = await copy();
  const readout = await page.getByTestId('handcam-readout').textContent();
  console.log(`readout: ${readout}`);
  const b = json(text);
  console.log('orbited snapshot', JSON.stringify(b));
  const turned = Math.abs(((b.azimuth - a.azimuth + 540) % 360) - 180);
  check(turned > 150, `azimuth turned about half a turn (${turned.toFixed(1)} deg)`);
  check(b.distance < a.distance - 0.1, `zoomed in (${a.distance} to ${b.distance})`);
  check(/export const CARD_DISTANCE = [\d.]+;/.test(text) && /CARD_AZIMUTH = \(-?[\d.]+ \* Math\.PI\) \/ 180;/.test(text), 'clipboard carries the RoleSelect block');
  const shown = Number(/azimuth (-?[\d.]+)/.exec(readout)?.[1]);
  check(Math.abs(shown - b.azimuth) < 1, `live readout shows the azimuth (${shown})`);

  await page.getByRole('button', { name: 'Reset to current default' }).click();
  await page.waitForTimeout(800);
  const r = json(await copy());
  check(Math.abs(r.azimuth - 20) < 0.5 && Math.abs(r.distance - 5.8) < 0.02, 'reset returns to the card camera');

  await page.getByLabel('Paste camera').fill(text);
  await page.getByRole('button', { name: 'Apply pasted camera' }).click();
  await page.waitForTimeout(800);
  const c = json(await copy());
  const same = c.position.every((v, i) => Math.abs(v - b.position[i]) < 0.01) && c.target.every((v, i) => Math.abs(v - b.target[i]) < 0.01);
  check(same, `pasted snapshot round-trips (${JSON.stringify(c.position)} vs ${JSON.stringify(b.position)})`);

  // Dev mode off: the route sends you home.
  await page.goto(`${BASE}/dev/hand-camera?dev=0`);
  await page.waitForURL((u) => u.pathname === '/', { timeout: 10000 });
  check(true, 'without dev mode the route redirects home');
} catch (e) {
  check(false, String(e));
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
