// Boot, screen flow and the frame loop.
import * as THREE from 'three';
import { Engine } from './engine.js';
import { loadModel, assetUrls } from './assets.js';
import { Track } from './track.js';
import { TRACKS, WORLDS, trackById } from './tracks.js';
import { RACERS, racerById } from './roster.js';
import { Race } from './race.js';
import { Hud, formatTime } from './hud.js';
import { Input } from './input.js';
import * as audio from './audio.js';
import * as progress from './progress.js';
import * as champ from './champ.js';
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
  difficulty: 0,
  champDifficulty: 0,   // picked on the championship screen before round 1
  world: 'grand',       // the world whose circuits the circuit screen shows
  single: false,        // single race: every circuit open, nothing to unlock
  champWorld: 'grand',  // and the one a new championship would tour
  inChamp: false,       // the race on screen is a championship round
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
  champ: document.getElementById('screen-champ'),
  results: document.getElementById('screen-results'),
  howto: document.getElementById('screen-howto'),
  paused: document.getElementById('screen-paused'),
};

function show(name) {
  state.screen = name;
  if (name === 'menu') updateMenu();
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
  return [...screen.querySelectorAll('button:not([disabled])')]
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

/* ---------------------------------------------------------------- worlds */

const worldTracks = (id) => TRACKS.filter((t) => t.world === id);
/** A world is open once its first circuit is. */
const worldOpen = (id) => state.progress.unlockedTracks.includes(worldTracks(id)[0]?.id);
/** Whether a circuit can be picked on the circuit screen right now. */
const trackOpen = (id) => state.single || state.progress.unlockedTracks.includes(id);

/** One button per world, built into each picker. A shut world says what
 *  opens it: a podium on the last circuit of the world before. */
function renderWorlds(el, current, anyWorld = false) {
  el.replaceChildren(...WORLDS.map((w, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'world';
    b.dataset.action = 'world';
    b.dataset.world = w.id;
    const open = anyWorld || worldOpen(w.id);
    b.disabled = !open;
    b.setAttribute('aria-pressed', String(w.id === current));
    const prev = i > 0 ? worldTracks(WORLDS[i - 1].id).at(-1) : null;
    b.innerHTML = `<span class="world-name">${w.name}</span>`
      + `<span class="world-sub">${open ? `${worldTracks(w.id).length} circuits` : `Podium ${prev?.name ?? ''} to open`}</span>`;
    return b;
  }));
}

function renderTracks() {
  const list = document.getElementById('track-list');
  list.replaceChildren();
  document.getElementById('tracks-title').textContent = state.single ? 'Single race' : 'Career';
  renderWorlds(document.getElementById('track-worlds'), state.world, state.single);
  for (const def of worldTracks(state.world)) {
    const unlocked = trackOpen(def.id);
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
  // Snow on a pale sky is white on white; a world can give its cards colour.
  const [c, g] = def.theme.card ?? [def.theme.sky, def.theme.ground];
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
  return `linear-gradient(90deg, ${hex(c)}, ${hex(g)})`;
}

/* -------------------------------------------------------------- car list */

const STAT_MAX = { engine: 20, topSpeed: 31, handling: 3.2, mass: 1.7 };
const DIFFICULTY = ['Rookie', 'Pro', 'Ace', 'Legend'];
// How each level is shown wherever it is picked or reported.
const LEVELS = [
  { blurb: 'First time? Start here.', colour: '#4ade80' },
  { blurb: 'A fair fight.', colour: '#38bdf8' },
  { blurb: 'Rivals who rarely miss.', colour: '#fb923c' },
  { blurb: 'No help. No mercy.', colour: '#f43f5e' },
];

/** The four level buttons, built once into each picker. */
function buildLevels(el) {
  el.replaceChildren(...DIFFICULTY.map((name, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'level';
    b.dataset.action = 'difficulty';
    b.dataset.diff = String(i);
    b.style.setProperty('--lvl', LEVELS[i].colour);
    b.innerHTML = `<span class="level-name">${name}</span><span class="level-blurb">${LEVELS[i].blurb}</span>`;
    return b;
  }));
}

function showLevel(el, value) {
  for (const b of el.querySelectorAll('.level')) b.setAttribute('aria-pressed', String(Number(b.dataset.diff) === value));
}

/** A level's name in its own colour, for the HUD and the results. */
function levelTag(i) {
  return `<b class="level-tag" style="color:${LEVELS[i].colour}">${DIFFICULTY[i]}</b>`;
}

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
      if (state.carsFrom === 'tracks') { state.inChamp = false; startRace(); }
      else if (state.carsFrom === 'champ') startChamp();
      else renderCars();
    });
    list.appendChild(el);
  }
  const chosen = racerById(state.racerId);
  const track = trackById(state.trackId);
  const offCareer = !state.progress.unlockedTracks.includes(track.id);
  const note = state.carsFrom === 'tracks'
    ? `${state.single ? 'Single race: ' : ''}${track.name} — ${track.laps} laps — ${DIFFICULTY[state.difficulty]}.`
      + (state.single && offCareer ? ' Best lap counts; it opens nothing in the career.' : ' Pick a car to start.')
    : state.carsFrom === 'champ'
      ? `${WORLDS.find((w) => w.id === state.champWorld).name} championship — ${worldTracks(state.champWorld).length} rounds — ${DIFFICULTY[state.champDifficulty]}. Pick a car to start.`
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

  // A championship round races the same five rivals every time.
  const c = !attract && state.inChamp ? state.progress.champ : null;
  const roster = c
    ? [c.racerId, ...c.rivals].map(racerById)
    : RACERS.filter((r) => !r.unlock || state.progress.unlockedCars.includes(r.id));
  const race = new Race({
    engine,
    track,
    playerSpec: attract ? RACERS[Math.floor(Math.random() * 4)] : racerById(c ? c.racerId : state.racerId),
    roster: roster.length >= 6 ? roster : RACERS,
    difficulty: attract ? 3 : c ? c.difficulty : state.difficulty,
  });
  state.race = race;
  state.attract = attract;
  race.onRumble = attract ? null : (strong, weak, ms) => input.rumble(strong, weak, ms);
  race.onTick = attract ? null : () => input.tick();
  if (attract) {
    race.setAutopilot(true, 0.95);
    race.phase = 'racing';
    race.clock = 0;
  } else {
    race.start();
  }
  const p = race.player;
  engine.look(p.x, p.y, p.z);
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
  hud.setLevel(levelTag(race.difficulty));
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
  const all = race.results();
  const mine = all.find((r) => r.isPlayer);
  scoreChampRace(race, all);
  progress.record(state.progress, {
    trackId: state.trackId,
    place: mine.place,
    bestLap: mine.best,
    tracks: TRACKS,
    cars: RACERS,
    single: state.single && !state.inChamp,
  });
}

function finishRace() {
  const race = state.race;
  race.settle();
  const results = race.results();
  const mine = results.find((r) => r.isPlayer);
  const gained = scoreChampRace(race, results);
  const unlocked = progress.record(state.progress, {
    trackId: state.trackId,
    place: mine.place,
    bestLap: mine.best,
    tracks: TRACKS,
    cars: RACERS,
    single: state.single && !state.inChamp,
  });

  document.getElementById('results-sub').innerHTML =
    `${levelTag(race.difficulty)} · ${trackById(state.trackId).name}${gained ? ` · round ${state.progress.champ.round} of ${state.progress.champ.rounds.length}` : ''}`;
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
      <span class="when">${r.time != null ? formatTime(r.time) : `still on lap ${r.lap}/${r.laps}`}${r.best != null ? ` · best ${formatTime(r.best)}` : ''}${gained ? ` <b class="pts">+${gained[r.id] ?? 0}</b>` : ''}</span>`;
    list.appendChild(li);
  }
  // A championship round moves on to the table, not to a rematch.
  const c = gained && state.progress.champ;
  document.getElementById('results-retry').classList.toggle('hidden', !!c);
  document.getElementById('results-next').classList.toggle('hidden', !!c);
  const standingsBtn = document.getElementById('results-standings');
  standingsBtn.classList.toggle('hidden', !c);
  if (c) standingsBtn.textContent = champ.isOver(c) ? 'Final standings' : 'Standings';
  // Show what the podium opened, not just say it.
  const box = document.getElementById('results-unlocks');
  box.replaceChildren();
  box.classList.toggle('hidden', !unlocked.length);
  for (const u of unlocked) {
    const el = document.createElement('div');
    el.className = 'unlock';
    const isTrack = u.kind === 'track';
    const newWorld = isTrack && trackById(u.id).world !== trackById(state.trackId).world;
    const art = isTrack ? trackArt.get(u.id) : carArt.get(u.id);
    const bg = isTrack ? `background:${swatch(trackById(u.id))}`
      : `background:radial-gradient(70% 90% at 50% 118%, ${racerById(u.id).colour}88, transparent 70%), rgba(255,255,255,0.06)`;
    el.innerHTML = `
      <div class="unlock-art" style="${bg}"><img src="${art || ''}" alt=""></div>
      <div><span class="unlock-kind">${newWorld ? `New world — ${WORLDS.find((w) => w.id === trackById(u.id).world).name}` : isTrack ? 'New circuit' : 'New car'}</span><span class="unlock-name">${u.name}</span></div>`;
    box.appendChild(el);
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

/* ---------------------------------------------------------- championship */

function updateMenu() {
  const c = state.progress.champ;
  document.getElementById('menu-champ').textContent = c && !champ.isOver(c)
    ? `Continue championship · round ${c.round + 1}/${c.rounds.length}`
    : 'Championship';
}

/** Round one: pick five rivals from the cars on offer and go. */
function startChamp() {
  const pool = RACERS.filter((r) => r.id !== state.racerId
    && (!r.unlock || state.progress.unlockedCars.includes(r.id)));
  const rivals = [];
  while (rivals.length < 5 && pool.length) {
    rivals.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id);
  }
  state.progress.champ = champ.create({
    difficulty: state.champDifficulty,
    racerId: state.racerId,
    rivals,
    rounds: worldTracks(state.champWorld).map((t) => t.id),
  });
  progress.save(state.progress);
  startChampRound();
}

function startChampRound() {
  const c = state.progress.champ;
  state.inChamp = true;
  state.racerId = c.racerId;
  state.trackId = c.rounds[c.round];
  startRace();
  state.race.message(`ROUND ${c.round + 1} OF ${c.rounds.length}`, 'go', 2.6);
}

/** Book a finished championship round, once. Returns the points each car
 *  took, or null for an ordinary race. */
function scoreChampRace(race, results) {
  const c = state.progress.champ;
  if (!state.inChamp || !c || champ.isOver(c) || race.champScored) return null;
  race.champScored = true;
  const gained = champ.score(c, results);
  if (champ.isOver(c)) {
    const place = champ.standings(c).findIndex((row) => row.isPlayer) + 1;
    const key = `${trackById(c.rounds[0]).world}:${c.difficulty}`;
    const prev = state.progress.champBest[key];
    if (!prev || place < prev) state.progress.champBest[key] = place;
  }
  progress.save(state.progress);
  return gained;
}

function renderChamp() {
  const c = state.progress.champ;
  const active = c && !champ.isOver(c);
  const rounds = c ? c.rounds.map(trackById) : worldTracks(state.champWorld);
  const world = WORLDS.find((w) => w.id === (c ? rounds[0].world : state.champWorld));
  const title = document.getElementById('champ-title');
  const sub = document.getElementById('champ-sub');
  const table = document.getElementById('champ-standings');
  const next = document.getElementById('champ-next');
  const rows = c ? champ.standings(c) : [];
  const myPlace = rows.findIndex((r) => r.isPlayer) + 1;

  if (!c) {
    title.textContent = 'Championship';
    const best = Object.entries(state.progress.champBest)
      .filter(([k]) => k.startsWith(`${world.id}:`))
      .map(([k, place]) => [Number(k.split(':')[1]), place])
      .sort((a, b) => a[1] - b[1] || b[0] - a[0])[0];
    sub.innerHTML = `Every circuit of ${world.name} in turn, the same five rivals, points for every place: <span class="nowrap">${champ.POINTS.join(' · ')}</span>.`
      + (best ? ` Your best: ${ordinal(best[1])} on ${DIFFICULTY[best[0]]}.` : '');
    next.textContent = 'Pick your car';
  } else if (active) {
    title.textContent = `${world.name} — ${DIFFICULTY[c.difficulty]}`;
    sub.textContent = c.round
      ? `After ${c.round} of ${c.rounds.length} rounds you are ${ordinal(myPlace)}. Next: ${rounds[c.round].name}.`
      : `Round 1 of ${c.rounds.length}: ${rounds[0].name}.`;
    next.textContent = `Race round ${c.round + 1}: ${rounds[c.round].name}`;
  } else {
    title.textContent = myPlace === 1 ? 'Champion!' : `Championship — ${ordinal(myPlace)}`;
    sub.textContent = `${DIFFICULTY[c.difficulty]} · ${rows[myPlace - 1].points} points`
      + (myPlace === 1 ? ' · the title is yours.' : myPlace <= 3 ? ' · on the podium.' : '.');
    next.textContent = 'New championship';
  }
  screens.champ.classList.toggle('is-champion', !!c && !active && myPlace === 1);
  document.getElementById('champ-difficulty').classList.toggle('hidden', !!c);
  const worlds = document.getElementById('champ-worlds');
  worlds.classList.toggle('hidden', !!c);
  renderWorlds(worlds, state.champWorld);
  showLevel(document.getElementById('champ-difficulty'), state.champDifficulty);
  document.getElementById('champ-abandon').classList.toggle('hidden', !active);

  // The rounds: each circuit, with your finish once it has been raced.
  const strip = document.getElementById('champ-rounds');
  strip.replaceChildren();
  rounds.forEach((def, i) => {
    const li = document.createElement('li');
    const done = c && i < c.round;
    const place = done ? c.places[c.racerId][i] : null;
    li.className = `round${done ? ' is-done' : ''}${active && i === c.round ? ' is-next' : ''}`;
    li.innerHTML = `
      <div class="round-art" style="background:${swatch(def)}"><img src="${trackArt.get(def.id) || ''}" alt=""></div>
      <span class="round-no">Round ${i + 1}</span>
      <span class="round-name">${def.name}</span>
      ${place ? `<span class="round-place p${place}">${ordinal(place)}</span>` : ''}`;
    strip.appendChild(li);
  });

  // The table.
  table.classList.toggle('hidden', !c);
  if (!c) return;
  const head = `<thead><tr><th></th><th>Driver</th>${rounds.map((d, i) => `<th title="${d.name}">R${i + 1}</th>`).join('')}<th>Pts</th></tr></thead>`;
  const body = rows.map((row, i) => {
    const car = racerById(row.id);
    const cells = rounds.map((_, k) => {
      const p = row.places[k];
      return `<td class="${p ? `p${p}` : 'dim'}">${p ?? '·'}</td>`;
    }).join('');
    return `<tr class="${row.isPlayer ? 'me' : ''}"><td class="pos">${i + 1}</td>`
      + `<td class="who"><i style="background:${car.colour}"></i>${car.name}${row.isPlayer ? ' <em>you</em>' : ''}</td>`
      + `${cells}<td class="pts">${row.points}</td></tr>`;
  }).join('');
  table.innerHTML = `${head}<tbody>${body}</tbody>`;
}

/* ------------------------------------------------------------ navigation */

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  audio.unlock();
  switch (action) {
    case 'race':
    case 'single':
      audio.sfx.select();
      state.inChamp = false;
      state.single = action === 'single';
      // Career picks up where you were; a single race from anything you
      // left selected, if the career has not reached it.
      if (!trackOpen(state.trackId)) state.trackId = TRACKS[0].id;
      state.world = trackById(state.trackId).world;
      renderTracks();
      show('tracks');
      break;
    case 'world': {
      audio.sfx.select();
      const id = btn.dataset.world;
      if (btn.closest('#champ-worlds')) {
        state.champWorld = id;
        renderChamp();
      } else {
        state.world = id;
        renderTracks();
      }
      // The buttons were rebuilt; keep the keyboard on the one just pressed.
      document.querySelector(`#screen-${state.screen} .world[data-world="${id}"]`)?.focus();
      break;
    }
    case 'champ':
    case 'champ-standings':
      audio.sfx.select();
      state.champDifficulty = state.difficulty;
      // Offer the furthest world reached.
      state.champWorld = [...WORLDS].reverse().find((w) => worldOpen(w.id))?.id ?? WORLDS[0].id;
      renderChamp();
      show('champ');
      break;
    case 'champ-next': {
      audio.sfx.select();
      const c = state.progress.champ;
      if (c && !champ.isOver(c)) { startChampRound(); break; }
      if (c) {                                   // finished: clear it for a fresh one
        state.progress.champ = null;
        progress.save(state.progress);
        renderChamp();
        focusFirst(screens.champ);
        break;
      }
      state.carsFrom = 'champ';
      renderCars();
      show('cars');
      break;
    }
    case 'champ-abandon':
      // Five races of standings deserve a second press.
      if (btn.dataset.armed) {
        audio.sfx.back();
        state.progress.champ = null;
        progress.save(state.progress);
        renderChamp();
        focusFirst(screens.champ);
      } else {
        audio.sfx.select();
        btn.dataset.armed = '1';
        btn.textContent = 'Sure? Press again';
        setTimeout(() => { delete btn.dataset.armed; btn.textContent = 'Abandon'; }, 3000);
      }
      break;
    case 'garage': audio.sfx.select(); state.carsFrom = 'menu'; renderCars(); show('cars'); break;
    case 'howto': audio.sfx.select(); show('howto'); break;
    case 'install': audio.sfx.select(); promptInstall(); break;
    case 'difficulty': audio.sfx.select(); pickLevel(btn); break;
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
      if (state.carsFrom === 'champ') { renderChamp(); show('champ'); break; }
      renderTracks();
      show('tracks');
      break;
    case 'to-cars': audio.sfx.select(); state.carsFrom = 'tracks'; renderCars(); show('cars'); break;
    case 'go':
      audio.sfx.select();
      if (state.carsFrom === 'champ') startChamp();
      else { state.inChamp = false; startRace(); }
      break;
    case 'retry': audio.sfx.select(); recordFinishedRace(); startRace(); break;
    case 'resume': audio.sfx.back(); state.paused = false; show('race'); break;
    case 'next-track': {
      audio.sfx.select();
      const i = TRACKS.findIndex((t) => t.id === state.trackId);
      const next = TRACKS[i + 1];
      if (next && trackOpen(next.id)) state.trackId = next.id;
      state.world = trackById(state.trackId).world;
      renderTracks();
      show('tracks');
      break;
    }
  }
});

{
  const pickRace = document.getElementById('difficulty');
  const pickChamp = document.getElementById('champ-difficulty');
  buildLevels(pickRace);
  buildLevels(pickChamp);
}

function pickLevel(btn) {
  const value = Number(btn.dataset.diff);
  const group = btn.closest('.levels');
  if (group.dataset.group === 'champ') {
    state.champDifficulty = value;
  } else {
    state.difficulty = value;
    state.progress.difficulty = value;
    progress.save(state.progress);
    renderTracks();
  }
  showLevel(group, value);
}

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
  // The difficulty is remembered between visits; Rookie until changed.
  state.difficulty = state.progress.difficulty;
  showLevel(document.getElementById('difficulty'), state.difficulty);
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
