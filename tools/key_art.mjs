// Renders Chrome Circuit's key art from the game itself, for GameVolt and
// anywhere else the game needs a picture: a pack on Mesa Eight at sundown,
// racing at the stone bridge and the start gantry beyond it, through a long
// lens, with the title.
//
//   python3 -m http.server 8124 &          (from the repo root)
//   npm i playwright-core                  (anywhere; point the import at it)
//   node tools/key_art.mjs
//
// Writes media/gamevolt/: hero.png (1920x1080), tall.png (800x1200),
// square.png (1080x1080) and the race on its own, without the title, as
// hero-clean.png. Set CHROME to a Chromium binary if Playwright cannot find
// one. The race is a real one, so every run frames a different moment.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../media/gamevolt/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const TRACK = 'mesa';

const browser = await chromium.launch({
  executablePath: process.env.CHROME,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:8124/');
await page.waitForSelector('#screen-menu.show', { timeout: 180000 });

// A single race on the circuit, run on autopilot until a pack runs close
// together 14-40 m from where the road passes under the stone bridge.
await page.evaluate((id) => {
  const T = window.__cc.TRACKS, w = T.find((t) => t.id === id).world;
  document.querySelector('[data-action="single"]').click();
  document.querySelector(`#track-worlds .world[data-world="${w}"]`).click();
  const idx = T.filter((t) => t.world === w).findIndex((t) => t.id === id);
  document.querySelector(`#track-list .card:nth-child(${idx + 1})`).click();
  document.querySelector('[data-action="go"]').click();
}, TRACK);
await page.waitForFunction(() => document.body.classList.contains('racing'));
const pack = await page.evaluate(async () => {
  const cc = window.__cc, r = cc.state.race, N = { throttle: 0, steer: 0, item: false, handbrake: false };
  cc.state.paused = true;
  r.setAutopilot(true, 1);
  for (let i = 0; i < 60 * 9; i++) r.update(1 / 60, N);
  const line = r.track.line;
  // Where the road runs under the bridge: off the deck, but beneath it.
  const deck = [], under = [];
  for (let i = 0; i < line.n; i++) if (line.bridgeAt(i)) deck.push(line.point(i));
  for (let i = 0; i < line.n; i++) {
    const p = line.point(i);
    if (!line.bridgeAt(i) && deck.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 4)) under.push(i);
  }
  const below = under[Math.floor(under.length / 2)] ?? r.track.startIndex;
  const past = (c) => ((((line.locate(c.x, c.z).index - below) % line.n) + line.n) % line.n) * line.spacing;
  const near = (c) => r.cars.filter((o) => Math.hypot(o.x - c.x, o.z - c.z) < 12).length;
  let subject = null, fallback = null;
  for (let i = 0; i < 60 * 150 && !subject; i++) {
    r.update(1 / 60, N);
    if (i % 3) continue;
    for (const c of r.cars) {
      if (near(c) < 4 || Math.abs(c.vLong) < 12) continue;
      fallback ||= c;
      if (past(c) > 14 && past(c) < 40) { subject = c; break; }
    }
  }
  subject ||= fallback || r.player;
  r.filming = true;
  r.update(1 / 60, N);
  for (const id of ['hud', 'sound-toggle', 'fullscreen-toggle', 'trophy-toast', 'toast', 'pad-hints', 'version-badge', 'update-chip']) {
    const el = document.getElementById(id);
    if (el) el.style.visibility = 'hidden';
  }
  document.getElementById('scene').style.filter = 'saturate(1.25) contrast(1.06)';
  const THREE = await import('three');
  const cam = new THREE.PerspectiveCamera(24, 16 / 9, 0.5, 900);
  // Ahead of the pack, a little above and to one side, on a long lens that
  // stacks the cars up under the bridge.
  window.__frame = (aspect, back, side, up, fov) => {
    const f = new THREE.Vector3(Math.sin(subject.heading), 0, Math.cos(subject.heading));
    const right = new THREE.Vector3(f.z, 0, -f.x);
    const c = new THREE.Vector3(subject.x, subject.y, subject.z);
    cam.position.copy(c).addScaledVector(f, -back).addScaledVector(right, side).add(new THREE.Vector3(0, up, 0));
    cam.fov = fov;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    // Past the car picked, so the rest of the pack and the bridge are in shot.
    cam.lookAt(c.clone().addScaledVector(f, -5).add(new THREE.Vector3(0, 0.8, 0)));
    // The page's own loop keeps drawing; it draws this camera now.
    cc.engine.render = function () { this.renderer.render(this.scene, cam); };
    cc.engine.render();
  };
  return near(subject);
});

// The title, set the way the game sets it, over a shade for legibility.
const TITLE = `
  <div id="keyart" style="position:fixed;inset:0;z-index:999;pointer-events:none;font-family:var(--display);color:#fff">
    <div class="shade" style="position:absolute;inset:0"></div>
    <div class="copy" style="position:absolute">
      <p style="margin:0 0 .5em;font:800 var(--eyebrow)/1 var(--body);letter-spacing:.42em;color:var(--accent);text-transform:uppercase;text-shadow:0 2px 12px #000a">Isometric arcade racing</p>
      <h1 style="margin:0;font-size:var(--title);line-height:.86;font-style:italic;letter-spacing:-.035em;
        text-shadow:-.03em 0 rgba(255,40,100,.55),.03em 0 rgba(40,210,255,.55),0 .12em .4em rgba(0,0,0,.6)">Chrome<span style="display:block;color:var(--accent)">Circuit</span></h1>
      <p style="margin:.9em 0 0;font:800 var(--line)/1.4 var(--body);letter-spacing:.3em;text-transform:uppercase;text-shadow:0 2px 12px #000c">
        Four worlds · Twelve circuits · <span style="color:var(--accent)">Rockets optional</span></p>
    </div>
  </div>`;
async function shot(name, w, h, frame, layout) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(400);
  await page.evaluate(([aspect, frame]) => window.__frame(aspect, ...frame), [w / h, frame]);
  await page.evaluate(() => document.getElementById('keyart')?.remove());
  await page.waitForTimeout(300);
  if (layout) {
    await page.evaluate(([html, l]) => {
      document.body.insertAdjacentHTML('beforeend', html);
      const k = document.getElementById('keyart');
      for (const [v, val] of Object.entries(l.vars)) k.style.setProperty(v, val);
      k.querySelector('.shade').style.background = l.shade;
      Object.assign(k.querySelector('.copy').style, l.copy);
    }, [TITLE, layout]);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log('wrote', name);
}

// [back, side, up, fov]: the camera's offset along the picked car's heading
// (negated), across it and up, and the lens.
const WIDE = [-26, 3.5, 4.5, 24];
await shot('hero-clean', 1920, 1080, WIDE, null);
await shot('hero', 1920, 1080, WIDE, {
  vars: { '--title': '150px', '--eyebrow': '22px', '--line': '24px' },
  shade: 'linear-gradient(90deg, rgba(10,6,14,.72) 0%, rgba(10,6,14,.35) 38%, transparent 62%), linear-gradient(0deg, rgba(10,6,14,.55), transparent 40%)',
  copy: { left: '96px', bottom: '96px' },
});
await shot('tall', 800, 1200, [-24, 2.5, 5.5, 38], {
  vars: { '--title': '104px', '--eyebrow': '15px', '--line': '14px' },
  shade: 'linear-gradient(0deg, rgba(10,6,14,.85) 0%, rgba(10,6,14,.45) 34%, transparent 55%)',
  copy: { left: '56px', right: '40px', bottom: '72px' },
});
await shot('square', 1080, 1080, [-25, 3, 5, 30], {
  vars: { '--title': '118px', '--eyebrow': '17px', '--line': '17px' },
  shade: 'linear-gradient(0deg, rgba(10,6,14,.8) 0%, rgba(10,6,14,.4) 32%, transparent 52%)',
  copy: { left: '64px', bottom: '72px' },
});
console.log(`pack of ${pack}`, errors.length ? `errors: ${errors.join(' | ')}` : '');
await browser.close();
