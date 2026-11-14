// Walks the robot screens in mock mode (no core, no backend, no gloves): the teleop screen (/robot) with the robot twin,
// marionette strings, fidelity lines, lag and the dead-man Engage (held with the mouse, toggled with Space), the Expert
// lesson and Off sources, a phone width; then "Teach the robot" on a skill page, which plays the expert lesson through
// the robot and scores its copy per finger. Fails on any console error or uncaught page error.
// Screenshots go to docs/screens/robot-*.png.
// Run: node e2e/robot-walk.mjs   (starts the Vite dev server on :5184 if nothing answers there; E2E_PORT picks the port).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, '../../genui/node_modules/playwright'));

const PORT = Number(process.env.E2E_PORT ?? 5184);
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

/** Every text node inside `scope` is at least 16px. */
async function minFont(page, scope, what) {
  const small = await page.evaluate((sel) => {
    const out = [];
    for (const el of document.querySelectorAll(`${sel} *`)) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16 && el.getBoundingClientRect().width > 0) out.push(`${el.tagName}.${el.className}: ${size}px "${el.textContent.trim().slice(0, 30)}"`);
    }
    return out;
  }, scope);
  if (small.length) fail(`${what}: text under 16px: ${small.slice(0, 4).join('; ')}`);
}

async function noSideScroll(page, what) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (wide) fail(`${what}: the page scrolls sideways`);
}

/** The 3D stage drew a scene: a flat colour compresses to a tiny PNG, the bottega set with two hands does not. */
async function canvasDrawn(page, sel, what) {
  await page.locator(`${sel} canvas`).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => fail(`${what}: no 3D stage`));
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    const png = await page.locator(sel).first().screenshot();
    if (png.length > 40000) return;
  }
  fail(`${what}: the 3D stage drew nothing`);
}

const shot = async (page, name, full = true) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}robot-${name}.png`, fullPage: full });
};

let exitCode = 0;
try {
  const page = await newPage({ width: 1440, height: 900 });

  step('the rail links to the robot screen; mock mode says it works the robot out in this browser');
  await open(page, '/apprentice');
  const rail = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Robot' });
  await visible(rail, 'rail Robot entry');
  await rail.click();
  await page.waitForURL(/\/robot/);
  await visible(page.getByRole('heading', { name: 'Robot', level: 1 }), 'Robot title');
  await visible(page.getByText(/Sample data: the core is not used/), 'connection line (mock)');
  await visible(page.getByText(/Unitree Dex3-1 loaded: 7 joints \(thumb, index, middle\) in this browser/), 'model loaded line');
  await canvasDrawn(page, '.rb-stage', 'teleop stage');
  await visible(page.getByText('Released: the robot holds still.'), 'released state');
  await visible(page.getByText(/Ring: the robot has no ring finger/), 'ring missing line');
  await visible(page.getByText(/Little: the robot has no little finger/), 'little missing line');
  await minFont(page, '.rb-page', 'teleop');
  await noSideScroll(page, 'teleop');
  await shot(page, '01-released');

  step('holding Engage makes the robot follow the hand; fidelity and lag appear');
  const engage = page.getByRole('button', { name: /Hold to engage|Engaged/ });
  const box = await engage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await visible(page.getByText('Engaged: the robot follows your hand.'), 'engaged state');
  await visible(page.getByText(/Thumb follows you fully \(\d+%\)|Thumb is at its joint limit/), 'thumb fidelity');
  await visible(page.getByText(/Index follows in 2 joints for your 3 \(\d+%\)|Index is at its joint limit/), 'index fidelity');
  await visible(page.getByText(/^Lag \d+ ms from a glove change to the robot, in this browser\.$/), 'lag line', 15000);
  if ((await engage.getAttribute('aria-pressed')) !== 'true') fail('Engage should be pressed while held');
  await shot(page, '02-engaged');
  await page.screenshot({ path: `${OUT}robot-02b-stage.png`, clip: await page.locator('.rb-stage').boundingBox() });
  await page.mouse.up();
  await visible(page.getByText('Released: the robot holds still.'), 'released after letting go');

  step('Space toggles the dead-man on and off');
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await page.keyboard.press('Space');
  await visible(page.getByText(/^Engaged/), 'engaged with Space');
  await page.keyboard.press('Space');
  await visible(page.getByText('Released: the robot holds still.'), 'released with Space');

  step('Expert lesson: the expert hand drives the robot');
  await page.getByRole('radio', { name: 'Expert lesson' }).click();
  await page.keyboard.press('Space');
  await visible(page.getByText(/Engaged: the robot follows the expert lesson/), 'lesson engaged');
  await shot(page, '03-lesson');
  await page.keyboard.press('Space');

  step('Off disables Engage');
  await page.getByRole('radio', { name: 'Off' }).click();
  await visible(page.getByText('Pick You or Expert lesson to drive the robot.'), 'off line');
  if (!(await page.getByRole('button', { name: 'Hold to engage' }).isDisabled())) fail('Engage should be disabled with Off');
  await page.keyboard.press('Space');
  await visible(page.getByText('Pick You or Expert lesson to drive the robot.'), 'still off after Space');

  step('phone width: no sideways scroll, text at least 16px');
  const phone = await newPage({ width: 390, height: 844 });
  await open(phone, '/robot');
  await visible(phone.getByRole('heading', { name: 'Robot', level: 1 }), 'phone title');
  await canvasDrawn(phone, '.rb-stage', 'phone stage');
  await noSideScroll(phone, 'phone teleop');
  await minFont(phone, '.rb-page', 'phone teleop');
  await shot(phone, '04-phone');
  await phone.close();

  step('Teach the robot on a skill page: plays the expert lesson through the robot and scores its copy');
  await open(page, '/apprentice');
  await page.locator('a[href^="/apprentice/skills/"]').first().click();
  await page.waitForURL(/\/apprentice\/skills\//);
  const teach = page.getByRole('button', { name: 'Teach the robot' });
  await visible(teach, 'Teach the robot button');
  await teach.click();
  await visible(page.getByText(/The robot is copying/), 'playing line');
  await canvasDrawn(page, '.rb-teach__stage', 'teach stage');
  await shot(page, '05-teach-playing');
  await visible(page.getByRole('heading', { name: 'The robot is the apprentice' }), 'result heading', 30000);
  await visible(page.getByText(/^Thumb \d+\./), 'thumb score line');
  await visible(page.getByText(/Ring: the robot has no ring finger/), 'ring line in result');
  await minFont(page, '.rb-teach', 'teach');
  await noSideScroll(page, 'teach');
  await shot(page, '06-teach-result');

  if (problems.length) fail(`console problems:\n${problems.join('\n')}`);
  console.log('robot walk passed');
} catch (e) {
  exitCode = 1;
  console.error(`FAILED: ${e.message}`);
  if (problems.length) console.error(problems.join('\n'));
  await current?.screenshot({ path: `${OUT}robot-zz-failure.png` }).catch(() => undefined);
} finally {
  await browser.close();
  if (vite) vite.kill();
  process.exit(exitCode);
}
