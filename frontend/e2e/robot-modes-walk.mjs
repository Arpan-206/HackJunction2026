// The robot screen's three modes in mock mode (no backend, no gloves, no engine): Copy me with both robots and a finger
// turned down, Show a move playing a lesson step on both robots, and Teach it taking a tapped phrase.
// Fails on any console error or uncaught page error. Screenshots go to docs/screens/robot-*.png.
// Run: node e2e/robot-modes-walk.mjs   (starts the Vite dev server on :5186 if nothing answers there; E2E_PORT picks the port).
// Playwright is taken from the repo's genui package, as in mock-walk.mjs.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, '../../genui/node_modules/playwright'));

const PORT = Number(process.env.E2E_PORT ?? 5186);
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
});
const shot = (name) => page.screenshot({ path: `${OUT}robot-${name}.png` });
const step = (msg) => console.log(`- ${msg}`);
const settle = (ms = 1500) => page.waitForTimeout(ms);
const visible = (locator, timeout = 20000) => locator.first().waitFor({ state: 'visible', timeout });

let failed = false;
try {
  await page.goto(`${BASE}/robot?mock=1`);
  await page.evaluate(() => localStorage.removeItem('apprentice.robotModel'));
  await page.goto(`${BASE}/robot?mock=1`);
  const modes = page.getByRole('radiogroup', { name: 'Robot mode' });
  await visible(modes);
  for (const label of ['Copy me', 'Show a move', 'Teach it']) await visible(modes.getByRole('radio', { name: label }));

  step('Copy me, three fingers: ring and little have no robot finger');
  await visible(page.getByText('How closely each finger copies you'));
  await page.getByRole('radio', { name: 'Three fingers' }).click();
  const ring = page.getByLabel(/^Ring/);
  if (!(await ring.isDisabled())) throw new Error('the three-finger robot offers a ring finger dial');
  await settle();
  await shot('01-copy-three');

  step('Copy me, five fingers, index turned down to 0%');
  await page.getByRole('radio', { name: 'Five fingers' }).click();
  const index = page.getByLabel(/^Index/);
  await index.fill('0');
  await visible(page.getByRole('button', { name: 'Copy every finger fully' }));
  await settle();
  await shot('02-copy-five-index-off');

  step('Show a move, five fingers: the lesson plays at once');
  await modes.getByRole('radio', { name: 'Show a move' }).click();
  await visible(page.getByRole('button', { name: 'Pause' }));
  await settle(2500);
  await shot('03-show-five');

  step('Show a move, three fingers: opens on sign language, retargeted');
  await page.getByRole('radio', { name: 'Three fingers' }).click();
  const lessonTitle = await page.locator('.rb-lesson select').first().evaluate((el) => el.options[el.selectedIndex]?.text ?? '');
  if (!/fingerspelling/i.test(lessonTitle)) throw new Error(`the three-finger robot should open on sign language, got "${lessonTitle}"`);
  console.log(`  lesson: ${lessonTitle}`);
  await settle(2500);
  await shot('04-show-three');

  step('Teach it: tap a ready-made phrase and the robot answers');
  await modes.getByRole('radio', { name: 'Teach it' }).click();
  await visible(page.getByLabel('Or tell it in words'));
  const phrase = page.getByRole('group', { name: 'Things to say' }).getByRole('button').first();
  await phrase.click();
  await settle(2000);
  await shot('05-teach');

  if (problems.length) throw new Error(problems.join('\n'));
  console.log('robot modes walk: ok');
} catch (e) {
  failed = true;
  console.error(`robot modes walk FAILED: ${e instanceof Error ? e.message : e}`);
  await shot('failure').catch(() => undefined);
} finally {
  await browser.close();
  vite?.kill();
}
process.exit(failed ? 1 : 0);
