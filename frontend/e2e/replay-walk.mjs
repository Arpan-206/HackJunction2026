// Walks the app while scripts/replay_demo.sh plays a glove capture, and checks the REPLAY corner mark on every screen
// that shows hands: /demo (plain and kiosk), /robot, the training room, /gloves, /lab and the expert screens, with the
// dev panel on and with Settings open. Fails when the mark is missing, smaller than 16 px, or hidden by anything,
// and on any uncaught page error. Screenshots go to docs/screens/replay-*.png.
//
//   GEPPETTO_CORE_PORT=9765 GEPPETTO_BACKEND_PORT=9000 GEPPETTO_FRONTEND_PORT=5973 \
//     scripts/replay_demo.sh logs/live/20261114-131952 --start 1500 --seconds 60     (in one terminal)
//   REPLAY_BASE=http://localhost:5973 node e2e/replay-walk.mjs                       (in another)
//
// Playwright comes from the repo's genui package, as in the other walks.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, '../../genui/node_modules/playwright'));

const BASE = process.env.REPLAY_BASE ?? 'http://localhost:5173';
const OUT = path.resolve(here, '../docs/screens') + path.sep;

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const problems = [];
const step = (msg) => console.log(`- ${msg}`);

async function badgeOn(page, label) {
  const mark = page.getByTestId('replay-badge');
  await mark.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {
    throw new Error(`${label}: no REPLAY mark`);
  });
  const info = await mark.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const note = el.querySelector('.replay-mark__note');
    const word = el.querySelector('.replay-mark__word');
    // What is drawn at the mark's centre: the mark itself, or something on top of it.
    const top = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).find((e) => !el.contains(e) && getComputedStyle(e).pointerEvents !== 'none');
    const z = (e) => Number(getComputedStyle(e).zIndex) || 0;
    return {
      text: el.textContent,
      w: r.width,
      h: r.height,
      inView: r.top >= 0 && r.right <= window.innerWidth + 1,
      noteSize: parseFloat(getComputedStyle(note).fontSize),
      wordSize: parseFloat(getComputedStyle(word).fontSize),
      opacity: getComputedStyle(el).opacity,
      covered: top ? z(top) > z(el) : false,
    };
  });
  if (!/replay/i.test(info.text)) problems.push(`${label}: mark text is "${info.text}"`);
  if (info.noteSize < 16 || info.wordSize < 16) problems.push(`${label}: text below 16 px (${info.noteSize}, ${info.wordSize})`);
  if (!info.inView || info.w < 40 || info.h < 20) problems.push(`${label}: mark off screen or too small (${JSON.stringify(info)})`);
  if (info.opacity !== '1') problems.push(`${label}: mark opacity ${info.opacity}`);
  if (info.covered) problems.push(`${label}: something is drawn over the mark`);
  return info;
}

async function visit(ctx, url, name, extra) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${name}: pageerror ${e.message}`));
  await page.goto(`${BASE}${url}`);
  // With no Rokoko driver the first shell page of a tab opens /gloves once (after the rig status arrives); the mark
  // must show there too, then the walk goes on as a visitor would.
  if (!url.startsWith('/gloves') && !url.startsWith('/demo')) {
    const gated = await page.waitForURL(/\/gloves\?next=/, { timeout: 8000 }).then(() => true, () => false);
    if (gated) {
      await badgeOn(page, `${name} (gloves check)`);
      await page.getByRole('link', { name: 'Continue without the gloves' }).click();
      await page.waitForURL((u) => !u.pathname.startsWith('/gloves'), { timeout: 8000 });
    }
  }
  await page.waitForTimeout(2500);
  if (extra) await extra(page);
  const info = await badgeOn(page, name);
  await page.screenshot({ path: `${OUT}replay-${name}.png` });
  step(`${name} (${url}): REPLAY mark ${Math.round(info.w)}x${Math.round(info.h)} px, note ${info.noteSize} px`);
  await page.close();
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await visit(ctx, '/demo', 'demo');
  await visit(ctx, '/robot', 'robot');
  await visit(ctx, '/apprentice/lessons/seed-table-tennis/steps/0', 'training-room');
  await visit(ctx, '/gloves', 'gloves');
  await visit(ctx, '/lab', 'hand-lab');
  await visit(ctx, '/expert/scratch', 'expert-scratch');
  await visit(ctx, '/apprentice?dev=1', 'dev-panel-on');
  await visit(ctx, '/apprentice', 'settings-open', async (page) => {
    await page.getByRole('button', { name: /settings/i }).first().click();
    await page.waitForTimeout(800);
  });
  await ctx.close();

  // The kiosk is its own tab (the flag sticks per tab), at the demo table's size.
  const kiosk = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await visit(kiosk, '/demo?kiosk=1', 'kiosk');
  // A phone width, where the rail becomes a bottom bar.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await visit(phone, '/apprentice', 'phone');
  await kiosk.close();
  await phone.close();
} catch (e) {
  problems.push(String(e.message ?? e));
} finally {
  await browser.close();
}

if (problems.length) {
  console.error('FAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('replay walk passed');
