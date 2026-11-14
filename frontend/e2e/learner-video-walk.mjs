// Walks the learner's lesson journey with expert video in mock mode (no Python backend): the course's three parts, a
// Tutorial without a video, a test clip recorded in the browser (canvas + MediaRecorder) uploaded through POST /api/media
// and attached to a take and a step, the Tutorial with that video, Practice (watch with strings, the change to Try it, the
// ghost on and off, the take video beside the expert), and one round of Play. Desktop 1536x760 and phone 390 wide.
// Fails on any console error or uncaught page error.
// Run: node e2e/learner-video-walk.mjs   (uses the dev server on :5173 when it answers, else starts one on E2E_PORT or 5183).
// Screenshots: OUT_DIR (default docs/screens), named learner-video-*.png.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, '../../genui/node_modules/playwright'));

const OUT = (process.env.OUT_DIR ?? path.resolve(here, '../docs/screens')) + path.sep;

async function up(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

let PORT = Number(process.env.E2E_PORT ?? 5173);
let vite = null;
if (!(await up(`http://localhost:${PORT}`))) {
  PORT = Number(process.env.E2E_PORT ?? 5183);
  const bin = path.resolve(here, '../node_modules/vite/bin/vite.js');
  vite = spawn(process.execPath, [bin, '--port', String(PORT), '--strictPort'], { cwd: path.resolve(here, '..'), stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up(`http://localhost:${PORT}`)); i++) await new Promise((r) => setTimeout(r, 300));
}
const BASE = `http://localhost:${PORT}`;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ viewport: { width: 1536, height: 760 } });
const problems = [];
let current = null;
const step = (msg) => console.log(`- ${msg}`);
const fail = (msg) => {
  throw new Error(msg);
};

async function newPage(viewport) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  current = page;
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // A headless Chrome without a GPU can log WebGL performance notes; only real errors count.
    if (m.type() === 'error' && !/GPU stall|WebGL/.test(m.text())) problems.push(`console.error: ${m.text()}`);
  });
  return page;
}

const visible = async (locator, what, timeout = 20000) => {
  await locator.first().waitFor({ state: 'visible', timeout }).catch(() => fail(`Expected to see: ${what}`));
};
const shot = (page, name) => page.screenshot({ path: `${OUT}learner-video-${name}.png` });

/** Records a 3 s test clip from a canvas in the page, uploads it, makes a take with it attached and a lesson using both. */
async function makeVideoLesson(page) {
  return page.evaluate(async () => {
    // Headless Chrome records a canvas only while it is on screen (it is removed before any screenshot), and a first
    // recording can come back as a bare header, so record until the clip plays.
    async function record() {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:9999';
      document.body.append(canvas);
      const ctx = canvas.getContext('2d');
      const rec = new MediaRecorder(canvas.captureStream(24), { mimeType: 'video/webm' });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const started = performance.now();
      let drawing = true;
      const draw = () => {
        if (!drawing) return;
        const t = (performance.now() - started) / 1000;
        ctx.fillStyle = '#e3d2ae';
        ctx.fillRect(0, 0, 320, 240);
        ctx.fillStyle = '#2a1b0f';
        ctx.font = '22px serif';
        ctx.fillText('Test clip', 110, 40);
        ctx.fillText(`${t.toFixed(1)} s`, 130, 220);
        ctx.beginPath();
        ctx.arc(160 + 90 * Math.sin(t * 2), 125, 28, 0, Math.PI * 2);
        ctx.fill();
        requestAnimationFrame(draw);
      };
      draw();
      rec.start();
      await new Promise((r) => setTimeout(r, 3000));
      rec.stop();
      await new Promise((r) => (rec.onstop = r));
      drawing = false;
      canvas.remove();
      const clip = new Blob(chunks, { type: 'video/webm' });
      const probe = document.createElement('video');
      probe.muted = true;
      probe.src = URL.createObjectURL(clip);
      const ok = await new Promise((r) => {
        probe.onloadedmetadata = () => r(true);
        probe.onerror = () => r(false);
        setTimeout(() => r(false), 4000);
      });
      URL.revokeObjectURL(probe.src);
      return ok ? clip : null;
    }
    let blob = null;
    for (let i = 0; i < 4 && !blob; i++) blob = await record();
    if (!blob) throw new Error('the browser could not record a playable test clip');
    const form = new FormData();
    form.append('video', blob, 'clip.webm');
    form.append('duration_s', '3');
    const media = await (await fetch('/api/media', { method: 'POST', body: form })).json();
    if (!media.id) throw new Error(`upload failed: ${JSON.stringify(media)}`);
    const served = await fetch(media.url);
    if (!served.ok || (await served.blob()).size !== blob.size) throw new Error('the stored clip did not come back');

    const json = (method, url, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
    const motion = { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5], beat_ms: 500 };
    await json('POST', '/api/dev/state', { simulator_motion: motion });
    const { recording_id } = await json('POST', '/api/recordings/start', { hands: 'right' });
    await new Promise((r) => setTimeout(r, 2600));
    await json('POST', `/api/recordings/${recording_id}/stop`);
    const take = await json('PUT', `/api/recordings/${recording_id}/video`, { media_id: media.id, offset_s: 0 });
    if (!take.video) throw new Error('the take did not keep its video');
    const lesson = await json('POST', '/api/lessons', {
      title: 'Counting fingers (video walk)',
      skill: 'general',
      summary: 'A walk-made lesson with a test clip as the expert video.',
      master_name: 'Demo expert',
      steps: [
        {
          title: 'Lesson 1: Count to five',
          instruction: 'Tap each finger down in turn, thumb to little finger, on the beat.',
          hands: 'right',
          motion,
          reference_recording_id: recording_id,
          tutorial_video: { media_id: media.id, url: media.url, offset_s: 0.5 },
        },
        { title: 'Lesson 2: Open hand', instruction: 'Hold the hand open and flat, fingers together.', hands: 'right', motion: { preset: 'hold_pose', pose: { thumb: 0.1, index: 0.05, middle: 0.05, ring: 0.05, little: 0.05 } } },
      ],
    });
    return lesson.id;
  });
}

/** Practice for one step: watch, the change, try with the ghost, ghost off. Shots get the suffix. */
async function practice(page, lessonId, suffix) {
  await page.goto(`${BASE}/apprentice/lessons/${lessonId}/steps/0`);
  const tryIt = page.getByRole('button', { name: 'Try it out' });
  await visible(tryIt, 'Try it out');
  await visible(page.locator('.ap-practice__pane .ap-pip video'), 'the take video beside the expert');
  await page.waitForTimeout(3500);
  await shot(page, `practice-watch${suffix}`);
  await tryIt.click();
  await page.waitForTimeout(550);
  await shot(page, `practice-transition${suffix}`);
  const begin = page.getByRole('button', { name: /Begin rep 1/ });
  await visible(begin, 'Begin rep after the change');
  await page.waitForTimeout(1800);
  await shot(page, `practice-try${suffix}`);
  const pipTime = await page.locator('.ap-practice__pane .ap-pip video').evaluate((v) => v.currentTime);
  if (!(pipTime > 0)) fail('the take video should play in time with the expert');
  await page.getByRole('checkbox', { name: /Show the expert.s ghost/ }).uncheck();
  await visible(page.getByText('The expert steps back while the ghost is off.'), 'expert panel with the ghost off');
  await page.waitForTimeout(1200);
  await shot(page, `practice-try-ghostoff${suffix}`);
  await page.getByRole('checkbox', { name: /Show the expert.s ghost/ }).check();
}

let exitCode = 0;
try {
  const page = await newPage({ width: 1536, height: 760 });
  step('course: the three parts, tutorial first');
  await page.goto(`${BASE}/apprentice/lessons/seed-finnish-fingerspelling?mock=1`);
  await page.waitForFunction(() => window.__apprenticeMock === true, null, { timeout: 15000 });
  await visible(page.getByRole('list', { name: 'The three parts of this course' }), 'the three parts line');
  await visible(page.getByRole('link', { name: 'Watch the tutorial' }), 'tutorial first on a fresh lesson');
  await page.waitForTimeout(1500);
  await shot(page, '1-course');

  step('tutorial without a video: the hand plays the move alone');
  await page.getByRole('link', { name: 'Watch the tutorial' }).click();
  await visible(page.getByRole('button', { name: 'Start practising' }), 'Start practising');
  if (await page.locator('.ap-tut video').count()) fail('no video should show without one');
  await page.waitForTimeout(2500);
  await shot(page, '2-tutorial-novideo');

  step('a test clip recorded in the browser, uploaded and attached to a take and a step');
  const lessonId = await makeVideoLesson(page);
  console.log(`  lesson ${lessonId}`);

  step('tutorial with the video: the hand follows the video clock');
  await page.goto(`${BASE}/apprentice/lessons/${lessonId}/steps/0/tutorial`);
  await visible(page.locator('.ap-tut video'), 'tutorial video');
  await page.getByRole('button', { name: 'Play the tutorial' }).click();
  await page.waitForTimeout(1800);
  const t = await page.locator('.ap-tut video').evaluate((v) => ({ at: v.currentTime, paused: v.paused, ready: v.readyState, error: v.error?.message ?? null, duration: v.duration, src: v.currentSrc.slice(0, 30) }));
  if (t.error || t.ready < 1 || !(t.duration > 0)) fail(`the tutorial video should be playing (${JSON.stringify(t)})`);
  await page.getByRole('button', { name: 'Half speed' }).click();
  await shot(page, '3-tutorial-video');

  step('practice: watch with strings, try it out, the ghost on and off');
  await practice(page, lessonId, '');

  step('play: one round of called moves');
  await page.goto(`${BASE}/apprentice/lessons/${lessonId}/play`);
  await page.getByRole('button', { name: 'Start the round' }).click();
  await visible(page.getByText(/Now\. Hold it/), 'a call being performed');
  await page.waitForTimeout(1500);
  await shot(page, '4-play-call');
  await visible(page.getByRole('heading', { name: 'Round over' }), 'the end of the round', 150000);
  await shot(page, '5-play-done');
  await page.goto(`${BASE}/apprentice/lessons/seed-table-tennis/play`);
  await page.waitForURL(/\/test$/, { timeout: 10000 }).catch(() => fail('Play on a course with a game should open that game'));

  step('phone 390: tutorial with video, practice, play');
  const phone = await newPage({ width: 390, height: 844 });
  await phone.goto(`${BASE}/apprentice/lessons/${lessonId}/steps/0/tutorial`);
  await visible(phone.locator('.ap-tut video'), 'tutorial video on a phone');
  await phone.waitForTimeout(2000);
  await shot(phone, '6-tutorial-video-390');
  await practice(phone, lessonId, '-390');
  await phone.goto(`${BASE}/apprentice/lessons/seed-shadow-puppets/play`);
  await phone.getByRole('button', { name: 'Start the round' }).click();
  await visible(phone.getByText(/Now\. Hold it/), 'a shadow puppet call');
  await phone.waitForTimeout(1500);
  await shot(phone, '7-play-shadow-390');
  const width = await phone.evaluate(() => document.documentElement.scrollWidth);
  if (width > 391) fail(`the phone page scrolls sideways (${width}px)`);
} catch (e) {
  problems.push(`walk failed: ${e.message}`);
  await current?.screenshot({ path: `${OUT}learner-video-zz-failure.png` }).catch(() => undefined);
}

await browser.close();
vite?.kill();
if (problems.length) {
  console.log('\nPROBLEMS');
  problems.forEach((p) => console.log(`  ${p}`));
  exitCode = 1;
} else console.log('\nLearner video walk finished with no console or page errors.');
process.exit(exitCode);
