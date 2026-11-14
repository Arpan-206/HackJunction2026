// Lane shadows, mock mode (no backend, no gloves): every shadow puppet from the skill page to a score card, a fingerspelling
// letter lesson to a score card, the word drill spelling a word to its score, and the letter chart.
// Fails on any console error or uncaught page error. Screenshots go to docs/screens/shadows-*.png.
// Run: node e2e/shadows-walk.mjs   (starts the Vite dev server on :5182 if nothing answers there; E2E_PORT picks the port).
// Playwright is taken from the repo's genui package, as in mock-walk.mjs.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, '../../genui/node_modules/playwright'));

const PORT = Number(process.env.E2E_PORT ?? 5182);
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
const shot = (name) => page.screenshot({ path: `${OUT}shadows-${name}.png` });
const step = (msg) => console.log(`- ${msg}`);
const settle = (ms = 1200) => page.waitForTimeout(ms);
const expectVisible = async (locator, what, timeout = 20000) => {
  await locator.first().waitFor({ state: 'visible', timeout }).catch(() => {
    throw new Error(`Expected to see: ${what}`);
  });
};

/** One rep in the training room, from the watch stage to the score card. Returns the overall score's label. */
async function repToScore(url, what) {
  await page.goto(url);
  await expectVisible(page.getByRole('button', { name: /Start with the strings/ }), `${what}: start button`);
  await page.getByRole('button', { name: /Start with the strings/ }).click();
  await expectVisible(page.getByRole('button', { name: /Begin (rep|attempt) 1/ }), `${what}: begin rep`);
  await page.getByRole('button', { name: /Begin (rep|attempt) 1/ }).click();
  await expectVisible(page.getByRole('region', { name: /Score for (attempt|rep) 1/ }), `${what}: score card`, 60000);
  return page.getByLabel(/Overall score/).first().getAttribute('aria-label');
}

let exitCode = 0;
try {
  step('mock on');
  await page.goto(`${BASE}/?mock=1`);
  await page.waitForFunction(() => window.__apprenticeMock === true, null, { timeout: 15000 });

  step('shadow puppets: the skill page starts lesson 1');
  await page.goto(`${BASE}/apprentice/skills/shadow_puppets`);
  await expectVisible(page.getByRole('link', { name: /Start lesson 1|Continue lesson/ }), 'shadow puppets primary action');

  const puppets = ['The rabbit', 'The talking dog', 'The swan', 'The flapping bird', 'The snail'];
  for (let i = 0; i < puppets.length; i++) {
    step(`shadow puppets: ${puppets[i]} on the wall, one rep, a score card`);
    await page.goto(`${BASE}/apprentice/lessons/seed-shadow-puppets/steps/${i}`);
    await expectVisible(page.locator('.sp-theatre__name', { hasText: puppets[i] }), `${puppets[i]} named above the wall`);
    const overall = await repToScore(`${BASE}/apprentice/lessons/seed-shadow-puppets/steps/${i}`, puppets[i]);
    console.log(`  ${puppets[i]}: ${overall}`);
    if (i === 0) {
      await settle(1500);
      await shot('01-rabbit-score');
    }
  }

  step('fingerspelling: a live skill with the drill and the chart on its page');
  await page.goto(`${BASE}/apprentice`);
  await page.getByRole('link', { name: /Fingerspelling/ }).click();
  await expectVisible(page.getByRole('link', { name: /Start lesson 1|Continue lesson/ }), 'fingerspelling primary action');
  await expectVisible(page.getByRole('link', { name: 'Spell a word' }), 'drill link');
  await settle(2000);
  await shot('02-fingerspelling-skill');

  step('fingerspelling: the letter A, one rep, a score card');
  console.log(`  A: ${await repToScore(`${BASE}/apprentice/lessons/seed-fingerspelling-a-m/steps/0`, 'letter A')}`);

  step('fingerspelling: the letter J with its motion, one rep, a score card');
  console.log(`  J: ${await repToScore(`${BASE}/apprentice/lessons/seed-fingerspelling-a-m/steps/9`, 'letter J')}`);

  step('fingerspelling: the word drill spells HAND letter by letter, then scores it');
  await page.goto(`${BASE}/apprentice/fingerspelling`);
  await page.getByRole('button', { name: 'HAND', exact: true }).click();
  await page.getByRole('button', { name: 'Spell HAND' }).click();
  await expectVisible(page.locator('.fs-now__letter', { hasText: 'H' }), 'first letter of the drill');
  await settle(1500);
  await shot('03-drill-running');
  await expectVisible(page.getByRole('region', { name: 'Score for HAND' }), 'drill score', 90000);
  const drillScore = await page.getByLabel(/Overall score/).first().getAttribute('aria-label').catch(() => null);
  const caption = await page.locator('.fs-table__cap').innerText();
  const rows = await page.locator('.fs-table tbody tr').allInnerTexts();
  console.log(`  HAND: ${drillScore ?? 'no scorer result'}; ${caption}`);
  console.log(`  ${rows.map((r) => r.replace(/\s+/g, ' ')).join(' | ')}`);
  if (rows.length !== 4) throw new Error(`the drill table should list 4 letters, not ${rows.length}`);
  if (!drillScore) throw new Error('the drill should be scored by the scorer');
  await shot('04-drill-score');

  step('fingerspelling: the letter chart, with the letters the gloves read alike');
  await page.getByRole('radio', { name: 'Letter chart' }).click();
  await expectVisible(page.getByRole('list', { name: 'The 26 letters' }), 'letter grid');
  await page.getByRole('button', { name: /^V/ }).first().click();
  await expectVisible(page.getByText(/do not sense spread/), 'U and V spread note');
  await settle(1500);
  await shot('05-chart');
} catch (e) {
  problems.push(`walk failed: ${e.message}`);
  await shot('zz-failure').catch(() => undefined);
}

await browser.close();
vite?.kill();
if (problems.length) {
  console.log('\nPROBLEMS');
  problems.forEach((p) => console.log(`  ${p}`));
  exitCode = 1;
} else console.log('\nWalk finished with no console or page errors.');
process.exit(exitCode);
