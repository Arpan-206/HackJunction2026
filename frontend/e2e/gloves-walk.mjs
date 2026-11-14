// Walks the gloves screen, the calibration area and demo mode in mock mode (no Python backend, no gloves): the status
// with each simulated problem and its fix step, the four calibration steps saved for a wearer, then demo mode reusing
// that calibration (drift check passes and goes straight in; with ?mockGloves=drift it asks for a recalibration).
// Fails on any console error or uncaught page error. Screenshots go to docs/screens/gloves-*.png.
// Run: node e2e/gloves-walk.mjs   (starts the Vite dev server on :5183 if nothing answers there).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, '../../genui/node_modules/playwright'));

const PORT = Number(process.env.E2E_PORT ?? 5183);
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(here, '../docs/screens') + path.sep;

async function up(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

let vite = null;
if (!(await up(BASE))) {
  const bin = path.resolve(here, '../node_modules/vite/bin/vite.js');
  vite = spawn(process.execPath, [bin, '--port', String(PORT), '--strictPort'], { cwd: path.resolve(here, '..'), stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up(BASE)); i++) await new Promise((r) => setTimeout(r, 300));
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const problems = [];
let current = null;
const step = (msg) => console.log(`- ${msg}`);
const fail = (msg) => {
  throw new Error(msg);
};

async function newPage(viewport) {
  const page = await browser.newPage({ viewport });
  current = page;
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  return page;
}

const visible = async (locator, what, timeout = 20000) => {
  await locator.first().waitFor({ state: 'visible', timeout }).catch(() => fail(`Expected to see: ${what}`));
};

async function open(page, url) {
  await page.goto(`${BASE}${url}${url.includes('?') ? '&' : '?'}mock=1`);
  await page.waitForFunction(() => window.__apprenticeMock === true, null, { timeout: 15000 });
}

/** Every text node on the screen is at least 16px. */
async function minFont(page, what) {
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.gl-page *')) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16 && el.getBoundingClientRect().width > 0) out.push(`${el.tagName}.${el.className}: ${size}px "${el.textContent.trim().slice(0, 30)}"`);
    }
    return out;
  });
  if (small.length) fail(`${what}: text under 16px: ${small.slice(0, 4).join('; ')}`);
}

/** No horizontal page scroll. */
async function noSideScroll(page, what) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (wide) fail(`${what}: the page scrolls sideways`);
}

const shot = async (page, name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}gloves-${name}.png`, fullPage: true });
};

let exitCode = 0;
try {
  const page = await newPage({ width: 1440, height: 900 });

  step('the rail line links to the gloves screen; ready shows both gloves, battery unknown, no fix step');
  await open(page, '/apprentice');
  const railLine = page.getByRole('link', { name: /Gloves simulated/ });
  await visible(railLine, 'rail glove line');
  await railLine.click();
  await page.waitForURL(/\/gloves\?/);
  await visible(page.getByRole('heading', { name: 'Gloves ready' }), 'ready title');
  await visible(page.getByText('Both gloves are ready.'), 'ready line');
  if ((await page.getByText('unknown', { exact: true }).count()) !== 2) fail('each glove should say its battery is unknown');
  await visible(page.getByText('Connected over USB'), 'USB link');
  await minFont(page, 'status');
  await shot(page, '01-status-ready');

  for (const [scenario, title, name] of [
    ['no_driver', 'The glove driver is not running', '02-no-driver'],
    ['studio', 'Rokoko Studio is open', '03-studio'],
    ['one_glove', 'The left glove is missing', '04-one-glove'],
    ['saturated', /Saturated sensors on the right glove/, '05-saturated'],
    ['not_streaming', /no program has asked the driver/, '06-not-streaming'],
    ['low_fps', /The left glove sends 31 frames a second/, '07-low-fps'],
  ]) {
    step(`scenario ${scenario}`);
    await open(page, `/gloves?mockGloves=${scenario}`);
    await visible(page.getByText(title), `${scenario}: ${title}`);
    await shot(page, name);
  }

  step('Start the gloves fixes the no_driver scenario');
  await open(page, '/gloves?mockGloves=no_driver');
  await page.getByRole('button', { name: 'Start the gloves' }).click();
  await visible(page.getByText('Both gloves are ready.'), 'ready after starting');
  await open(page, '/gloves?mockGloves=ready');

  step('calibration step 1: connection and the wearer');
  await page.getByRole('link', { name: 'Calibrate gloves' }).click();
  await visible(page.getByRole('heading', { name: 'Connect the gloves' }), 'step 1');
  await page.getByLabel('Who is wearing the gloves?').fill('Ada');
  await shot(page, '10-calibrate-connection');
  await page.getByRole('button', { name: 'Next: the start pose' }).click();

  step('calibration step 2: the start pose with a countdown, then the quality reading');
  await visible(page.getByRole('heading', { name: 'Hold the start pose' }), 'step 2');
  await shot(page, '11-calibrate-start-pose');
  await page.getByRole('button', { name: 'Capture the start pose' }).click();
  await visible(page.getByText('Hands flat, palms down, thumbs together'), 'countdown caption');
  await visible(page.getByText('Hold still'), 'hold overlay', 10000);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}gloves-12-calibrate-holding.png` });
  await visible(page.getByText(/^(Good|Fair|Poor) calibration/), 'quality reading', 15000);
  await visible(page.getByText('Noise at rest'), 'noise line');
  await shot(page, '13-calibrate-quality');
  await page.getByRole('button', { name: 'Next: the range' }).click();

  step('calibration step 3: flat and fist per hand');
  await visible(page.getByRole('heading', { name: 'Range: flat, then a fist' }), 'step 3');
  await shot(page, '14-calibrate-range');
  for (const hand of ['Left hand', 'Right hand']) {
    const card = page.locator('.mst-cal', { has: page.getByRole('heading', { name: hand }) });
    await card.getByRole('button', { name: /^Calibrate/ }).click();
    await visible(card.getByText('Calibrated'), `${hand} calibrated`, 30000);
  }
  await page.getByRole('button', { name: 'Next: check the hands follow' }).click();

  step('calibration step 4: the hands follow; save');
  await visible(page.getByRole('heading', { name: 'Check the hands follow' }), 'step 4');
  await shot(page, '15-calibrate-verify');
  await page.getByRole('button', { name: 'Save without the check' }).click();
  await visible(page.getByRole('heading', { name: 'Saved for Ada' }), 'saved');
  await shot(page, '16-calibrate-saved');

  step('demo mode: switch it on in Settings');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('switch', { name: 'Demo mode' }).click();
  if ((await dialog.getByLabel('Who wears the gloves').inputValue()) !== 'Ada') fail('the wearer should show in Settings');
  await page.waitForTimeout(400);
  await dialog.getByRole('heading', { name: 'Gloves' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}gloves-20-settings-demo.png` });
  await dialog.getByRole('button', { name: 'Done' }).click();

  step('demo mode on app start: hold still, the drift check passes, straight in');
  await page.evaluate(() => window.sessionStorage.removeItem('apprentice.glovesChecked'));
  await open(page, '/apprentice?mockGloves=ready');
  await page.waitForURL(/\/gloves\?next=/, { timeout: 15000 });
  await visible(page.getByRole('heading', { name: 'Demo mode' }), 'demo section');
  await visible(page.getByText('Hold still'), 'hold still', 15000);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}gloves-21-demo-hold-still.png` });
  await page.waitForURL(/\/apprentice/, { timeout: 15000 });

  step('demo mode with drift: asks for a recalibration');
  await open(page, '/gloves?mockGloves=drift');
  await visible(page.getByText(/Recalibrate\.$/), 'drift message', 20000);
  await visible(page.getByRole('link', { name: 'Recalibrate' }), 'recalibrate link');
  await shot(page, '22-demo-drift');
  await page.evaluate(() => {
    window.localStorage.removeItem('apprentice.demoMode');
    window.sessionStorage.removeItem('apprentice.mockGloves');
  });
  await page.close();

  step('phone width: no sideways scroll');
  const phone = await newPage({ width: 390, height: 844 });
  await open(phone, '/gloves?mockGloves=saturated');
  await visible(phone.getByText(/Saturated sensors on the right glove/), 'saturated on a phone');
  await noSideScroll(phone, 'phone status');
  await shot(phone, '30-phone-status');
  await phone.close();
} catch (e) {
  problems.push(`walk failed: ${e.message}`);
  await current?.screenshot({ path: `${OUT}gloves-zz-failure.png` }).catch(() => undefined);
}

await browser.close();
vite?.kill();
if (problems.length) {
  console.log('\nPROBLEMS');
  problems.forEach((p) => console.log(`  ${p}`));
  exitCode = 1;
} else console.log('\nGloves walk finished with no console or page errors.');
process.exit(exitCode);
