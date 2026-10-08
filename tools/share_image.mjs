// Renders the link-preview card, icons/share.jpg: a real race, framed on a
// set piece with the pack round it, the title card on the left.
//
//   python3 -m http.server 8124 &          (from the repo root)
//   npm i playwright-core                  (anywhere; point the import at it)
//   node tools/share_image.mjs icons/share.jpg mesa:bridgecars:46:0
//
// The scene is track:mode:zoom:skip. Modes: bridgecars and ford wait for four
// cars round the bridge or the ford, pack for three round the player, bridge
// for the player up on the deck, air for the player in the air. Set CHROME to
// a Chromium binary if Playwright cannot find one.
import { chromium } from 'playwright-core';
const OUT = process.argv[2];
const [id, mode, zoom, tSkip] = (process.argv[3] || 'mesa:bridge:40:0').split(':');
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:8124/'); await page.waitForSelector('#screen-menu.show', { timeout: 90000 });
await page.evaluate((id) => {
  const cc = window.__cc;
  document.querySelector('[data-action="single"]').click();
  const T = cc.TRACKS, w = T.find((t) => t.id === id).world;
  document.querySelector(`#track-worlds .world[data-world="${w}"]`).click();
  const idx = T.filter((t) => t.world === w).findIndex((t) => t.id === id);
  document.querySelector(`#track-list .card:nth-child(${idx + 1})`).click();
  document.querySelector('[data-action="go"]').click();
}, id);
await page.waitForFunction(() => document.body.classList.contains('racing'));
const info = await page.evaluate(async ([mode, zoom, tSkip]) => {
  const cc = window.__cc, r = cc.state.race, p = r.player, L = r.track.line;
  r.onEvent = null;                    // no trophies, and no toast, for a picture
  const { AIDriver } = await import('./src/ai.js');
  const hands = new AIDriver(p, r.track, { skill: 0.9, seed: 4, drift: true });
  hands.launchDelay = 0;
  let t = 0;
  while (t < 150) {
    hands.update(1 / 60, r.cars, r);
    r.update(1 / 60, { throttle: p.throttle, steer: p.steer, handbrake: p.handbrake });
    t += 1 / 60;
    if (t < +tSkip) continue;
    // Close company: at least three cars within 12 of the player.
    const near = r.cars.filter((c) => c !== p && Math.hypot(c.x - p.x, c.z - p.z) < 12).length;
    if (mode === 'bridge' && L.bridgeAt(p.lineIndex) && p.y > 6 && near >= 2) break;
    // A spot worth looking at, with cars round it: the bridge, the ford.
    const spot = mode === 'bridgecars' ? (() => { const b = r.track.bridgePts; return { x: b.reduce((a, q) => a + q.x, 0) / b.length, z: b.reduce((a, q) => a + q.z, 0) / b.length }; })()
      : mode === 'ford' ? r.track.terrain.riverPath.find((q) => q.s === 0) : null;
    if (spot) {
      const round = r.cars.filter((c) => Math.hypot(c.x - spot.x, c.z - spot.z) < 17).length;
      if (r.phase === 'racing' && round >= 4) { window.__spot = spot; break; }
    }
    if (mode === 'pack' && r.phase === 'racing' && near >= 3) break;
    if (mode === 'air' && p.airborne && p.airTime > 0.3 && near >= 1) break;
  }
  r.update = () => {};
  document.getElementById('hud').style.visibility = 'hidden';
  document.getElementById('sound-toggle').style.visibility = 'hidden';
  document.getElementById('trophy-toast').style.visibility = 'hidden';
  cc.engine.setZoom(+zoom);
  // Put the action right of centre, clear of the title card on the left.
  const f = window.__spot ?? p, k = +zoom * 0.3;
  cc.engine.look(f.x - k * Math.SQRT1_2, (f.y ?? p.y), f.z + k * Math.SQRT1_2);
  if (r.marker) r.marker.visible = false;
  for (const key of Object.keys(r)) if (/marker/i.test(key) && r[key]?.isObject3D) r[key].visible = false;
  // The title card, in the menu's own type.
  const card = document.createElement('div');
  card.innerHTML = `<p class="eyebrow">Isometric arcade racing</p><h1 class="title">Chrome<span>Circuit</span></h1>
    <p class="share-line">12 circuits · 4 worlds</p><p class="share-line share-line--sub">Drift, boost, rockets, ghosts</p><p class="share-line share-line--dim">Free in your browser</p>`;
  Object.assign(card.style, { position: 'fixed', left: '0', top: '0', bottom: '0', width: '520px', padding: '120px 0 0 56px', zIndex: 50, textAlign: 'left',
    background: 'linear-gradient(90deg, rgba(10,12,18,0.88) 0%, rgba(10,12,18,0.72) 55%, rgba(10,12,18,0) 100%)' });
  const style = document.createElement('style');
  style.textContent = `.share-line{margin:18px 0 0;font-size:24px;font-weight:600;color:#f2f5fb;text-shadow:0 2px 10px #000}.share-line--sub{margin-top:6px;font-size:20px;color:#c9d1e3}.share-line--dim{margin-top:16px;font-size:20px;color:#ffcc32}
    body > div .title{font-size:84px;line-height:.92;margin:6px 0 0}body > div .eyebrow{font-size:16px}`;
  document.head.appendChild(style);
  document.body.appendChild(card);
  return { t: t.toFixed(1), y: p.y.toFixed(1) };
}, [mode, zoom, tSkip]);
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT, type: 'jpeg', quality: 86 });
console.log(JSON.stringify(info), 'errors', errors.join('|') || 'none');
await browser.close();
