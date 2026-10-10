// Persisted progression: unlocked circuits, unlocked cars, best lap times,
// and a championship in progress.
import { RACERS } from './roster.js';
import { TRACKS, WORLDS } from './tracks.js';
import { validate as validateChamp } from './champ.js';

const KEY = 'chrome-circuit-progress-v1';

// The career is a run of cups, one per world. A world opens whole: all its
// circuits at once, when the cup before it ends on the podium.
const worldTrackIds = (id) => TRACKS.filter((t) => t.world === id).map((t) => t.id);

const blank = () => ({
  unlockedTracks: worldTrackIds(WORLDS[0].id), unlockedCars: [], best: {}, places: {}, difficulty: 0,
  champ: null,      // the championship in progress (or just finished)
  champBest: {},    // best final championship place, by `world:difficulty`
  trials: {},       // time trial best lap per circuit, with its ghost
  endingSeen: false, // the credits have rolled for winning it all
});

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    // Valid JSON is not necessarily valid progress — a wrong-typed field
    // here would crash the boot sequence, so each one must earn its place.
    const p = JSON.parse(raw);
    const d = blank();
    const out = {
      unlockedTracks: Array.isArray(p.unlockedTracks)
        ? [...new Set([...d.unlockedTracks, ...p.unlockedTracks])]
        : d.unlockedTracks,
      unlockedCars: Array.isArray(p.unlockedCars) ? p.unlockedCars : d.unlockedCars,
      best: isObj(p.best) ? p.best : d.best,
      places: isObj(p.places) ? p.places : d.places,
      difficulty: [0, 1, 2, 3].includes(p.difficulty) ? p.difficulty : d.difficulty,
      champ: validateChamp(p.champ, RACERS.map((r) => r.id), TRACKS.map((t) => t.id)),
      champBest: isObj(p.champBest) ? migrateChampBest(p.champBest) : d.champBest,
      trials: validTrials(p.trials),
      endingSeen: p.endingSeen === true,
    };
    derive(out);
    return out;
  } catch {
    return blank();
  }
}

/** What a save has earned, worked out again from what it has won, so a
 *  world or car added after the cup was won is open too. A world opens when
 *  the cup before it ended on the podium, at any level; one with any circuit
 *  open (a save from when circuits opened one by one) opens whole. A car
 *  comes with a podium in its world's cup. */
function derive(p) {
  const podium = (worldId) => Object.entries(p.champBest).some(([k, v]) => k.startsWith(`${worldId}:`) && v <= 3);
  WORLDS.forEach((w, i) => {
    const ids = worldTrackIds(w.id);
    const open = i === 0 || podium(WORLDS[i - 1].id) || ids.some((id) => p.unlockedTracks.includes(id));
    if (open) for (const id of ids) if (!p.unlockedTracks.includes(id)) p.unlockedTracks.push(id);
  });
  for (const car of RACERS) {
    if (car.unlock && podium(car.unlock) && !p.unlockedCars.includes(car.id)) p.unlockedCars.push(car.id);
  }
}

/** Championship bests have been keyed three ways. By difficulty alone, from
 *  before there was more than one world: those were the Grand Tour. Then
 *  `grand:level`, for the five-round Grand Tour, which has since split into
 *  City Lights and Country Roads: a Grand Tour title raced every circuit of
 *  both, so it stands for both. */
function migrateChampBest(raw) {
  const out = {};
  const keep = (k, v) => { if (Number.isInteger(v) && v >= 1 && (out[k] == null || v < out[k])) out[k] = v; };
  for (const [k, v] of Object.entries(raw)) {
    const level = /^\d$/.test(k) ? k : /^grand:(\d)$/.exec(k)?.[1];
    if (level != null) { keep(`city:${level}`, v); keep(`country:${level}`, v); } else keep(k, v);
  }
  return out;
}

/** Everything back to a first run: circuits, cars, times, championships. */
export function reset() {
  const fresh = blank();
  save(fresh);
  return fresh;
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

/** Saved time trials, entry by entry: a bad one is dropped, not the lot. */
function validTrials(raw) {
  if (!isObj(raw)) return {};
  const out = {};
  for (const [id, t] of Object.entries(raw)) {
    if (!TRACKS.some((d) => d.id === id) || !isObj(t)) continue;
    if (!(t.time > 0) || typeof t.car !== 'string' || !Array.isArray(t.s) || t.s.length % 6) continue;
    if (!t.s.every(Number.isFinite)) continue;
    out[id] = { time: t.time, car: t.car, s: t.s };
  }
  return out;
}

/** Keep a time trial lap if it beats the one on record. Returns whether it did. */
export function recordTrial(state, trackId, ghost) {
  const prev = state.trials[trackId];
  if (prev && prev.time <= ghost.time) return false;
  state.trials[trackId] = { time: ghost.time, car: ghost.car, s: ghost.s };
  save(state);
  return true;
}

/** Record a finished race: its place and best lap. Unlocking is the cups'
 *  job (recordCup). A single race on a circuit the career has not reached
 *  keeps its best lap but not its place. */
export function record(state, { trackId, place, bestLap, single = false }) {
  const open = state.unlockedTracks.includes(trackId);
  if (open || !single) {
    const prev = state.places[trackId];
    if (prev == null || place < prev) state.places[trackId] = place;
  }
  if (bestLap != null && (state.best[trackId] == null || bestLap < state.best[trackId])) state.best[trackId] = bestLap;
  save(state);
}

/** A cup is over: on the podium it opens the next world, whole, and its car.
 *  Returns what it opened, for the results screen. */
export function recordCup(state) {
  const before = { tracks: [...state.unlockedTracks], cars: [...state.unlockedCars] };
  derive(state);
  save(state);
  const opened = [];
  for (const w of WORLDS) {
    const first = worldTrackIds(w.id)[0];
    if (!before.tracks.includes(first) && state.unlockedTracks.includes(first)) opened.push({ kind: 'world', id: w.id, name: w.name });
  }
  for (const id of state.unlockedCars) {
    if (!before.cars.includes(id)) opened.push({ kind: 'car', id, name: RACERS.find((r) => r.id === id)?.name ?? id });
  }
  return opened;
}
