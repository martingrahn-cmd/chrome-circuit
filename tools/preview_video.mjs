// Films a short, silent gameplay preview, the kind GameVolt plays on a game's
// card and in Big Picture: a few seconds each of three worlds, in the game's
// own camera with its HUD, cross-faded, as media/gamevolt/preview.mp4.
//
//   python3 -m http.server 8124 &          (from the repo root)
//   npm i playwright-core                  (anywhere; point the import at it)
//   node tools/preview_video.mjs
//
// Needs ffmpeg (FFMPEG=...). Frames are stepped by hand, so a slow software
// renderer still films smoothly. Each race is a real one on autopilot,
// filmed once the player's car is running in the pack.
import { chromium } from 'playwright-core';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = new URL('../media/gamevolt/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, CLIP = 3.5, FADE = 0.3;
// Closer than the game's own camera, which backs out at speed: on a small
// card the cars have to read.
const ZOOM = 25;
const TRACKS = ['neon', 'frostvale', 'canyonrun'];

const browser = await chromium.launch({
  executablePath: process.env.CHROME,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:8124/');
await page.waitForSelector('#screen-menu.show', { timeout: 180000 });

const dir = mkdtempSync(join(tmpdir(), 'preview-'));
const clips = [];
for (const id of TRACKS) {
  await page.evaluate((id) => {
    const T = window.__cc.TRACKS, w = T.find((t) => t.id === id).world;
    if (window.__cc.state.screen !== 'menu') document.querySelector('#screen-paused [data-action="back-menu"]')?.click();
    document.querySelector('[data-action="single"]').click();
    document.querySelector(`#track-worlds .world[data-world="${w}"]`).click();
    const idx = T.filter((t) => t.world === w).findIndex((t) => t.id === id);
    document.querySelector(`#track-list .card:nth-child(${idx + 1})`).click();
    document.querySelector('[data-action="go"]').click();
  }, id);
  await page.waitForFunction(() => document.body.classList.contains('racing'));
  await page.evaluate(() => {
    const cc = window.__cc, r = cc.state.race;
    cc.state.paused = true;              // the page's loop draws but moves nothing
    for (const el of ['sound-toggle', 'fullscreen-toggle', 'trophy-toast', 'toast', 'pad-hints', 'version-badge', 'update-chip', 'touch']) {
      const e = document.getElementById(el);
      if (e) e.style.visibility = 'hidden';
    }
    // Through the lights, then on until two or more cars run close by.
    cc.sim(8, { auto: true });
    for (let i = 0; i < 300; i++) {
      const p = r.player, near = r.cars.filter((c) => c !== p && Math.hypot(c.x - p.x, c.z - p.z) < 14).length;
      if (near >= 2 && Math.abs(p.vLong) > 12) break;
      cc.sim(0.25, { auto: true });
    }
  });
  const frames = join(dir, id);
  mkdirSync(frames);
  for (let k = 0; k < Math.round(CLIP * FPS); k++) {
    await page.evaluate(([dt, zoom]) => {
      const cc = window.__cc;
      cc.sim(dt, { auto: true });
      cc.engine.setZoom(zoom);
      cc.engine.render();
    }, [1 / FPS, ZOOM]);
    await page.screenshot({ path: join(frames, `f${String(k).padStart(4, '0')}.png`) });
  }
  clips.push(frames);
  console.log('filmed', id);
  await page.evaluate(() => { window.__cc.state.paused = false; });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}
await browser.close();

// Each clip, then the three cross-faded into one.
const parts = clips.map((frames, i) => {
  const out = join(dir, `clip${i}.mp4`);
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', join(frames, 'f%04d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', out]);
  return out;
});
const fades = [];
let last = '[0:v]';
for (let i = 1; i < parts.length; i++) {
  const tag = i === parts.length - 1 ? '[v]' : `[x${i}]`;
  fades.push(`${last}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${(CLIP - FADE) * i}${tag}`);
  last = tag;
}
execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...parts.flatMap((p) => ['-i', p]),
  '-filter_complex', fades.join(';'), '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${OUT}preview.mp4`]);
rmSync(dir, { recursive: true });
console.log('wrote preview.mp4', errors.length ? `errors: ${errors.join(' | ')}` : '');
