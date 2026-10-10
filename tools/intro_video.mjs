// Films the opening titles frame by frame, with the song under them, to
// intro.mp4: for checking the cut, and as a trailer for the game's page.
//
//   python3 -m http.server 8124 &          (from the repo root)
//   npm i playwright-core                  (anywhere; point the import at it)
//   node tools/intro_video.mjs [out.mp4] [fps]
//
// Needs ffmpeg (FFMPEG=…). Each frame is stepped by hand rather than played,
// so a slow software renderer still gives a smooth film; the overlay's CSS
// animations are held and set to the same clock.
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = process.argv[2] || 'intro.mp4';
const FPS = Number(process.argv[3] || 30);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const ROOT = new URL('..', import.meta.url).pathname;
const frames = mkdtempSync(join(tmpdir(), 'intro-'));

const browser = await chromium.launch({
  executablePath: process.env.CHROME,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:8124/?intro');
await page.waitForSelector('#screen-loading.ready', { timeout: 180000 });
await page.mouse.click(640, 360);
await page.waitForFunction(() => window.__cc.state.intro);
const length = await page.evaluate(() => {
  const cc = window.__cc, intro = cc.state.intro;
  // Take the clock: the page's own loop keeps drawing but no longer moves anything.
  intro.tick = () => {};
  cc.state.paused = true;
  for (const el of ['version-badge', 'update-chip', 'sound-toggle', 'fullscreen-toggle', 'install-btn']) {
    const e = document.getElementById(el);
    if (e) e.style.visibility = 'hidden';
  }
  window.__seen = new Map();
  window.__step = (t, dt) => {
    intro.t = t;
    cc.state.race.update(dt, { throttle: 0, steer: 0, item: false, handbrake: false });
    intro.film(dt);
    intro.overlay();
    for (const a of document.getAnimations()) {
      if (!window.__seen.has(a)) window.__seen.set(a, t);
      a.pause();
      a.currentTime = (t - window.__seen.get(a)) * 1000;
    }
    cc.engine.render(intro.camera);
  };
  return cc.introLength;
});

const n = Math.ceil(length * FPS);
for (let k = 0; k < n; k++) {
  await page.evaluate(([t, dt]) => window.__step(t, dt), [k / FPS, 1 / FPS]);
  await page.screenshot({ path: join(frames, `f${String(k).padStart(4, '0')}.png`) });
  if (k % 30 === 0) console.log(`frame ${k}/${n}`);
}
await browser.close();

execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
  '-framerate', String(FPS), '-i', join(frames, 'f%04d.png'),
  '-i', join(ROOT, 'assets/music/karts.mp3'),
  '-t', String(length), '-af', `afade=t=out:st=${length - 0.6}:d=0.6`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-shortest', OUT]);
rmSync(frames, { recursive: true });
console.log('wrote', OUT, errors.length ? `errors: ${errors.join(' | ')}` : '');
