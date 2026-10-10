// Renders the aerial preview of every circuit, assets/previews/{id}.jpg: the
// whole loop and the country round it, framed from the game's own camera, as
// the circuit cards, the big preview on the circuit screen and the career's
// rounds show them.
//
//   python3 -m http.server 8124 &          (from the repo root)
//   npm i playwright-core                  (anywhere; point the import at it)
//   node tools/track_previews.mjs [ids...]
//
// Set CHROME to a Chromium binary if Playwright cannot find one. Run it
// again whenever a circuit or its scenery changes.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../assets/previews/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROME,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:8124/');
await page.waitForSelector('#screen-menu.show', { timeout: 120000 });
const ids = await page.evaluate(() => window.__cc.TRACKS.map((t) => t.id));

for (const id of ids.filter((i) => !only.length || only.includes(i))) {
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
  await page.evaluate(async () => {
    const cc = window.__cc, r = cc.state.race, e = cc.engine;
    r.update = () => {};
    r.onEvent = null;
    for (const el of ['hud', 'sound-toggle', 'trophy-toast']) document.getElementById(el).style.visibility = 'hidden';
    for (const key of Object.keys(r)) if (/marker/i.test(key) && r[key]?.isObject3D) r[key].visible = false;
    // From this high up the fog would wash the far side out, and falling
    // snow is only noise.
    e.scene.fog = null;
    if (r.snow) r.snow.points.visible = false;
    const THREE = await import('three');
    const pts = r.track.line.pts, L = r.track.line;
    let x = 0, z = 0;
    for (const p of pts) { x += p.x; z += p.z; }
    x /= pts.length; z /= pts.length;
    // Fit the loop: frame it, see how far it reaches on screen, scale to fit.
    let zoom = 120;
    for (let pass = 0; pass < 3; pass++) {
      e.setZoom(zoom); e.look(x, 4, z);
      e.camera.updateMatrixWorld();
      let reach = 0;
      const v = new THREE.Vector3();
      for (let i = 0; i < pts.length; i += 3) {
        v.set(pts[i].x, L.h[i], pts[i].z).project(e.camera);
        reach = Math.max(reach, Math.abs(v.x) / 0.9, Math.abs(v.y) / 0.86);
      }
      zoom *= reach;
    }
    e.setZoom(zoom); e.look(x, 4, z);
    const s = e.sun.shadow.camera;
    s.left = -zoom * 1.2; s.right = zoom * 1.2; s.top = zoom * 1.2; s.bottom = -zoom * 1.2; s.far = 700;
    s.updateProjectionMatrix();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}${id}.jpg`, type: 'jpeg', quality: 78 });
  console.log('preview', id);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('#screen-paused [data-action="back-menu"]').click());
  await page.waitForTimeout(300);
}
console.log('errors', errors.join('|') || 'none');
await browser.close();
