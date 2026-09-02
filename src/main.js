// Boot, screen flow and the frame loop.
import * as THREE from 'three';
import { Engine } from './engine.js';
import { loadModel, assetUrls } from './assets.js';
import { Track } from './track.js';
import { TRACKS, trackById } from './tracks.js';
import { RACERS, racerById } from './roster.js';
import { Race } from './race.js';
import { Hud, formatTime } from './hud.js';
import { Input } from './input.js';
import * as audio from './audio.js';
import * as progress from './progress.js';
import { carThumbnails, trackThumbnail } from './thumbs.js';
import { watchVersion } from './version.js';
import { registerServiceWorker, cacheAssets, watchInstall, promptInstall } from './pwa.js';

const canvas = document.getElementById('scene');
const engine = new Engine(canvas);
engine.world = new THREE.Group();
engine.scene.add(engine.world);

const hud = new Hud(document.getElementById('hud'));
const input = new Input();
input.bindTouch(document.getElementById('touch'));

const state = {
  screen: 'loading',
  trackId: 'downtown',
  carsFrom: 'tracks',
  racerId: 'comet',
  difficulty: 1,
  race: null,
  attract: false,
  paused: false,
  progress: progress.load(),
};

const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
// The CSS that clears room for the touch buttons keys off this class, so it
// follows the same pointer-capability test as the buttons themselves.
// ("is-touch", not "touch" — the pad container already uses that class.)
document.body.classList.toggle('is-touch', isTouch);
input.touch.auto = isTouch;
document.getElementById('touch-pause').addEventListener('click', () => togglePause());

/* ------------------------------------------------------------ preloading */

function requiredModels() {
  const set = new Set();
  for (const r of RACERS) set.add(`cars/${r.model}`);
  for (const def of TRACKS) {
    const t = new Track(def);
    for (const [kit, name] of t.modelsUsed()) set.add(`${kit}/${name}`);
  }
  set.add('items/item-box');
  set.add('cars/debris-bolt');
  set.add('roads/dumpster');
  return [...set].map((s) => s.split('/'));
}

async function preload() {
  const list = requiredModels();
  const fill = document.getElementById('loading-fill');
  const text = document.getElementById('loading-text');
  let done = 0;
  const step = () => {
    done++;
    fill.style.width = `${Math.round((done / list.length) * 100)}%`;
  };
  const CONCURRENCY = 8;
  let cursor = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < list.length) {
      const [kit, name] = list[cursor++];
      try { await loadModel(kit, name); } catch (err) { console.warn('missing model', kit, name, err); }
      step();
    }
  });
  await Promise.all(workers);
  text.textContent = 'Painting the liveries…';
  carArt = carThumbnails(RACERS);
  for (const def of TRACKS) trackArt.set(def.id, trackThumbnail(def));
  text.textContent = 'Ready.';
}

let carArt = new Map();
const trackArt = new Map();

/* -------------------------------------------------------------- screens */

const screens = {
  loading: document.getElementById('screen-loading'),
  menu: document.getElementById('screen-menu'),
  tracks: document.getElementById('screen-tracks'),
  cars: document.getElementById('screen-cars'),
  results: document.getElementById('screen-results'),
  howto: document.getElementById('screen-howto'),
  paused: document.getElementById('screen-paused'),
};

function show(name) {
  state.screen = name;
  for (const [key, el] of Object.entries(screens)) el.classList.toggle('show', key === name);
  document.getElementById('hud').classList.toggle('hidden', name !== 'race');
  document.body.classList.toggle('racing', name === 'race');
  document.getElementById('touch').classList.toggle('hidden', !(name === 'race' && isTouch));
  focusFirst(screens[name]);
  // On a phone the pickers are a sideways strip; bring the current choice in.
  const chosen = screens[name]?.querySelector('.card-grid .card[aria-pressed="true"]');
  const strip = chosen?.parentElement;
  if (strip && strip.scrollWidth > strip.clientWidth) {
    chosen.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
}

/* ------------------------------------------------- menu focus navigation */

function focusables(screen) {
  if (!screen) return [];
  return [...screen.querySelectorAll('button:not([disabled]), select')]
    .filter((el) => el.offsetParent !== null);
}

function focusFirst(screen) {
  const items = focusables(screen);
  if (!items.length) { document.activeElement?.blur?.(); return; }
  const preferred = screen.querySelector('.card[aria-pressed="true"]:not([disabled])')
    || screen.querySelector('.btn--primary:not([disabled])')
    || items[0];
  preferred.focus({ preventScroll: true });
}

/** Move focus to the nearest control in a direction, using screen geometry. */
function navigate(dir) {
  const screen = screens[state.screen];
  const items = focusables(screen);
  if (!items.length) return;
  const current = items.includes(document.activeElement) ? document.activeElement : null;
  if (!current) { items[0].focus(); return; }

  if (current.tagName === 'SELECT' && (dir === 'left' || dir === 'right')) {
    const next = current.selectedIndex + (dir === 'right' ? 1 : -1);
    if (next >= 0 && next < current.options.length) {
      current.selectedIndex = next;
      current.dispatchEvent(new Event('change', { bubbles: true }));
      audio.sfx.select();
    }
    return;
  }

  const a = current.getBoundingClientRect();
  const ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2;
  let best = null, bestScore = Infinity;
  for (const el of items) {
    if (el === current) continue;
    const b = el.getBoundingClientRect();
    const dx = (b.left + b.right) / 2 - ax;
    const dy = (b.top + b.bottom) / 2 - ay;
    const forward = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    if (forward <= 4) continue;
    const lateral = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = forward + lateral * 2.4;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { best.focus(); audio.sfx.select(); }
}

function activateFocused() {
  const screen = screens[state.screen];
  const el = document.activeElement;
  if (el && screen?.contains(el)) {
    if (el.tagName === 'BUTTON') { el.click(); return; }
    // A focused select is adjusted with left/right; confirm on it must not
    // fire some unrelated button.
    if (el.tagName === 'SELECT') return;
  }
  // Focus got lost: take the screen's main action, same as focusFirst prefers.
  (screen?.querySelector('.btn--primary') || focusables(screen)[0])?.click();
}

function backOut() {
  const screen = screens[state.screen];
  // Resume must win on the pause screen; "Quit to menu" also matches ^="back"
  // and comes first in document order.
  const el = screen?.querySelector('[data-action="resume"]')
    || screen?.querySelector('[data-action^="back"]');
  if (el) el.click();
}

/* ------------------------------------------------------------ track list */

function renderTracks() {
  const list = document.getElementById('track-list');
  list.replaceChildren();
  for (const def of TRACKS) {
    const unlocked = state.progress.unlockedTracks.includes(def.id);
    const card = document.createElement('button');
    card.className = 'card';
    card.type = 'button';
    card.disabled = !unlocked;
    card.setAttribute('aria-pressed', String(state.trackId === def.id));
    const best = state.progress.best[def.id];
    const place = state.progress.places[def.id];
    card.innerHTML = `
      <div class="card-art" style="background:${swatch(def)}">
        <img src="${trackArt.get(def.id) || ''}" alt="" ${unlocked ? '' : 'style="opacity:.25"'}>
      </div>
      <p class="card-name">${unlocked ? def.name : 'Locked'}</p>
      <p class="card-blurb">${unlocked ? def.blurb : 'Finish the previous circuit in the top three.'}</p>
      <div class="card-meta">
        <span>${def.laps} laps</span>
        <span>${'★'.repeat(def.difficulty)}${'·'.repeat(5 - def.difficulty)}</span>
        ${best ? `<span>best ${formatTime(best)}</span>` : ''}
        ${place ? `<span>P${place}</span>` : ''}
      </div>`;
    // Picking a circuit is the choice; do not make people walk to a button.
    card.addEventListener('click', () => {
      state.trackId = def.id;
      audio.sfx.select();
      state.carsFrom = 'tracks';
      renderCars();
      show('cars');
    });
    list.appendChild(card);
  }
}

function swatch(def) {
  const c = def.theme.sky;
  const g = def.theme.ground;
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
  return `linear-gradient(90deg, ${hex(c)}, ${hex(g)})`;
}

/* -------------------------------------------------------------- car list */

const STAT_MAX = { engine: 20, topSpeed: 31, handling: 3.2, mass: 1.7 };
const DIFFICULTY = ['Rookie', 'Pro', 'Ace', 'Legend'];

function renderCars() {
  const list = document.getElementById('car-list');
  list.replaceChildren();
  for (const car of RACERS) {
    const unlocked = !car.unlock || state.progress.unlockedCars.includes(car.id);
    const el = document.createElement('button');
    el.className = 'card';
    el.type = 'button';
    el.disabled = !unlocked;
    el.setAttribute('aria-pressed', String(state.racerId === car.id));
    el.innerHTML = `
      <div class="card-art card-art--car" style="--tint:${car.colour}">
        <img src="${carArt.get(car.id) || ''}" alt="" ${unlocked ? '' : 'style="filter:grayscale(1);opacity:.3"'}>
      </div>
      <p class="card-name">${unlocked ? car.name : 'Locked'}</p>
      <p class="card-blurb">${unlocked ? car.blurb : `Podium on ${trackById(car.unlock).name}.`}</p>
      <div class="bars">
        ${bar('Speed', car.topSpeed / STAT_MAX.topSpeed)}
        ${bar('Accel', car.engine / STAT_MAX.engine)}
        ${bar('Grip', car.handling / STAT_MAX.handling)}
        ${bar('Weight', car.mass / STAT_MAX.mass)}
      </div>`;
    el.addEventListener('click', () => {
      state.racerId = car.id;
      audio.sfx.select();
      // Reached from the circuit list this is the last choice, so go racing.
      // Reached from the garage it is just browsing.
      if (state.carsFrom === 'tracks') startRace();
      else renderCars();
    });
    list.appendChild(el);
  }
  const chosen = racerById(state.racerId);
  const track = trackById(state.trackId);
  const note = state.carsFrom === 'tracks'
    ? `${track.name} — ${track.laps} laps — ${DIFFICULTY[state.difficulty]}. Pick a car to start.`
    : `${chosen.name} selected.`;
  document.getElementById('car-note').textContent = note;
}

function bar(label, v) {
  return `<div class="bar"><span>${label}</span><i style="--v:${Math.round(Math.max(0.08, Math.min(1, v)) * 100)}%"></i></div>`;
}

/* ------------------------------------------------------------ race setup */

function disposeWorld() {
  engine.world.traverse((o) => {
    if (o.isMesh || o.isPoints) {
      if (o.geometry) o.geometry.dispose();
    }
  });
  engine.world.clear();
}

const NEUTRAL = { throttle: 0, steer: 0, item: false, handbrake: false };

/** Build a race on the given track. `attract` races run themselves. */
function buildRace(def, { attract = false } = {}) {
  if (state.race) state.race.dispose();
  disposeWorld();

  const track = new Track(def);
  track.build(engine.world);
  engine.setSky(def.theme.sky, 170, 360);
  engine.setLighting(def.theme.light);

  const roster = RACERS.filter((r) => !r.unlock || state.progress.unlockedCars.includes(r.id));
  const race = new Race({
    engine,
    track,
    playerSpec: attract ? RACERS[Math.floor(Math.random() * 4)] : racerById(state.racerId),
    roster: roster.length >= 6 ? roster : RACERS,
    difficulty: attract ? 3 : state.difficulty,
  });
  state.race = race;
  state.attract = attract;
  race.onRumble = attract ? null : (strong, weak, ms) => input.rumble(strong, weak, ms);
  if (attract) {
    race.setAutopilot(true, 0.95);
    race.phase = 'racing';
    race.clock = 0;
  } else {
    race.start();
  }
  const p = race.player;
  engine.look(p.x, 0, p.z);
  return race;
}

/** A self-driving race loops behind the menus. */
function startAttract() {
  const pool = TRACKS.filter((t) => state.progress.unlockedTracks.includes(t.id));
  const def = pool[Math.floor(Math.random() * pool.length)] || TRACKS[0];
  buildRace(def, { attract: true });
}

function startRace() {
  const def = trackById(state.trackId);
  const race = buildRace(def);
  hud.reset();
  hud.prepareMap(race.track);
  state.paused = false;
  show('race');
  audio.unlock();
}

/** A race quit between the flag and the results screen still counts. */
function recordFinishedRace() {
  const race = state.race;
  if (!race || state.attract || race.phase !== 'finished') return;
  race.settle();
  const mine = race.results().find((r) => r.isPlayer);
  progress.record(state.progress, {
    trackId: state.trackId,
    place: mine.place,
    bestLap: mine.best,
    tracks: TRACKS,
    cars: RACERS,
  });
}

function finishRace() {
  const race = state.race;
  race.settle();
  const results = race.results();
  const mine = results.find((r) => r.isPlayer);
  const unlocked = progress.record(state.progress, {
    trackId: state.trackId,
    place: mine.place,
    bestLap: mine.best,
    tracks: TRACKS,
    cars: RACERS,
  });

  document.getElementById('results-title').textContent =
    mine.place === 1 ? 'Winner!' : mine.place <= 3 ? `Podium — ${ordinal(mine.place)}` : `Finished ${ordinal(mine.place)}`;

  const list = document.getElementById('results-list');
  list.replaceChildren();
  for (const r of results) {
    const li = document.createElement('li');
    li.className = r.isPlayer ? 'me' : '';
    li.innerHTML = `
      <span class="place">${r.place}</span>
      <span class="who">${r.name}</span>
      <span class="when">${r.time != null ? formatTime(r.time) : `still on lap ${r.lap}/${r.laps}`}${r.best != null ? ` · best ${formatTime(r.best)}` : ''}</span>`;
    list.appendChild(li);
  }
  if (unlocked.length) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="place">★</span><span class="who">Unlocked: ${unlocked.map((u) => u.name).join(', ')}</span><span class="when"></span>`;
    list.appendChild(li);
  }

  race.dispose();
  show('results');
  renderTracks();
  renderCars();
  startAttract();
}

function ordinal(n) {
  return ['', '1st', '2nd', '3rd', '4th', '5th', '6th'][n] || `${n}th`;
}

/* ------------------------------------------------------------ navigation */

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  audio.unlock();
  switch (action) {
    case 'race': audio.sfx.select(); renderTracks(); show('tracks'); break;
    case 'garage': audio.sfx.select(); state.carsFrom = 'menu'; renderCars(); show('cars'); break;
    case 'howto': audio.sfx.select(); show('howto'); break;
    case 'install': audio.sfx.select(); promptInstall(); break;
    case 'back-menu':
      audio.sfx.back();
      recordFinishedRace();
      state.paused = false;
      if (!state.attract) startAttract();
      show('menu');
      break;
    case 'back-tracks':
      // The garage is reached both from the main menu and mid-race-setup.
      audio.sfx.back();
      if (state.carsFrom === 'menu') { show('menu'); break; }
      renderTracks();
      show('tracks');
      break;
    case 'to-cars': audio.sfx.select(); state.carsFrom = 'tracks'; renderCars(); show('cars'); break;
    case 'go': audio.sfx.select(); startRace(); break;
    case 'retry': audio.sfx.select(); recordFinishedRace(); startRace(); break;
    case 'resume': audio.sfx.back(); state.paused = false; show('race'); break;
    case 'next-track': {
      audio.sfx.select();
      const i = TRACKS.findIndex((t) => t.id === state.trackId);
      const next = TRACKS[i + 1];
      if (next && state.progress.unlockedTracks.includes(next.id)) state.trackId = next.id;
      renderTracks();
      show('tracks');
      break;
    }
  }
});

document.getElementById('difficulty').addEventListener('change', (e) => {
  state.difficulty = Number(e.target.value);
});

const soundBtn = document.getElementById('sound-toggle');
soundBtn.addEventListener('click', () => {
  const on = !audio.isEnabled();
  audio.setEnabled(on);
  soundBtn.dataset.muted = String(!on);
});

function togglePause() {
  if (state.screen !== 'race' && state.screen !== 'paused') return;
  state.paused = !state.paused;
  show(state.paused ? 'paused' : 'race');
  audio.sfx.back();
}

const ARROWS = { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right' };

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  // Key auto-repeat must not flicker the pause; arrows may keep repeating.
  if (k === 'escape' || k === 'p') { if (!e.repeat) togglePause(); return; }
  if (state.screen === 'race') return;
  if (ARROWS[k]) { e.preventDefault(); navigate(ARROWS[k]); }
});

/* --------------------------------------------------------- pad presence */

function padHint() {
  const on = input.hasPad();
  document.body.dataset.pad = on ? '1' : '';
  hud.setControlHint(on ? 'Ⓧ / Ⓨ' : isTouch ? '★ button' : 'Space');
}

input.onPadChange = (connected, id) => {
  padHint();
  toast(connected ? `Gamepad connected — ${padName(id)}` : 'Gamepad disconnected');
};

function padName(id) {
  if (!id) return 'controller';
  const m = id.match(/^([^(]+)/);
  return (m ? m[1] : id).trim().slice(0, 28) || 'controller';
}

let toastTimer = 0;
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* -------------------------------------------------------------- the loop */

let last = performance.now();

/** Advance in slices of at most 1/60s so handling does not drift with fps. */
function step(race, dt, control) {
  let left = dt;
  while (left > 1e-4) {
    const slice = Math.min(1 / 60, left);
    race.update(slice, control);
    left -= slice;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state.screen !== 'race') {
    for (const action of input.menuActions(dt)) {
      if (action === 'confirm' || action === 'start') activateFocused();
      else if (action === 'back') backOut();
      else navigate(action);
    }
  } else {
    for (const action of input.menuActions(dt)) {
      if (action === 'start' || action === 'back') togglePause();
    }
  }

  if (state.race && !state.paused) {
    const race = state.race;
    if (state.attract) {
      step(race, dt, NEUTRAL);
      if (race.isOver) startAttract();
    } else if (state.screen === 'race') {
      step(race, dt, input.read());
      hud.update(race);
      if (race.isOver) finishRace();
    }
  }
  engine.render();
}

/* ----------------------------------------------------------------- boot */

(async function boot() {
  show('loading');
  // Registered before the models start downloading so the worker is installing
  // while the loading bar fills, not after it.
  registerServiceWorker();
  await preload();
  cacheAssets(assetUrls());
  await new Promise((r) => setTimeout(r, 180));
  renderTracks();
  renderCars();
  startAttract();
  padHint();
  show('menu');
  watchVersion(document.getElementById('version-badge'), document.getElementById('update-chip'));
  watchInstall(document.getElementById('install-btn'));
  requestAnimationFrame(frame);
})();
// Debug hook: advance the simulation at a fixed step without waiting on rAF.
function sim(seconds, control = {}) {
  const race = state.race;
  if (!race) return null;
  if (control.auto !== undefined) race.setAutopilot(control.auto);
  const input = { throttle: 1, steer: 0, item: false, handbrake: false, ...control };
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step) race.update(step, input);
  hud.update(race);
  return { phase: race.phase, lap: race.player.lap, pos: race.player.racePosition };
}

window.__cc = { state, engine, TRACKS, sim, input, navigate };
