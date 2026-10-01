// Persisted progression: unlocked circuits, unlocked cars, best lap times,
// and a championship in progress.
import { RACERS } from './roster.js';
import { TRACKS } from './tracks.js';
import { validate as validateChamp } from './champ.js';

const KEY = 'chrome-circuit-progress-v1';

const blank = () => ({
  unlockedTracks: ['downtown'], unlockedCars: [], best: {}, places: {}, difficulty: 0,
  champ: null,      // the championship in progress (or just finished)
  champBest: {},    // best final championship place, by `world:difficulty`
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
      // Bests used to be keyed by difficulty alone, from before there was
      // more than one world; those were all Grand Tour.
      champBest: isObj(p.champBest)
        ? Object.fromEntries(Object.entries(p.champBest).map(([k, v]) => [/^\d$/.test(k) ? `grand:${k}` : k, v]))
        : d.champBest,
    };
    // A podium opens the next circuit. Re-derive that from the places on
    // record, so a circuit added after the podium was won is open too — a
    // Pinecrest podium from before Alpine Winter existed opens Frostvale.
    TRACKS.forEach((t, i) => {
      const next = TRACKS[i + 1];
      if (next && out.places[t.id] <= 3 && !out.unlockedTracks.includes(next.id)) out.unlockedTracks.push(next.id);
    });
    return out;
  } catch {
    return blank();
  }
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

/** Record a finished race and return what it unlocked. A single race on a
 *  circuit the career has not reached yet keeps its best lap, but its place
 *  opens nothing — not the next circuit, not a car. */
export function record(state, { trackId, place, bestLap, tracks, cars, single = false }) {
  const unlocked = [];
  if (single && !state.unlockedTracks.includes(trackId)) {
    if (bestLap != null && (state.best[trackId] == null || bestLap < state.best[trackId])) state.best[trackId] = bestLap;
    save(state);
    return unlocked;
  }
  const prevPlace = state.places[trackId];
  if (prevPlace == null || place < prevPlace) state.places[trackId] = place;
  if (bestLap != null && (state.best[trackId] == null || bestLap < state.best[trackId])) {
    state.best[trackId] = bestLap;
  }
  if (place <= 3) {
    const i = tracks.findIndex((t) => t.id === trackId);
    const next = tracks[i + 1];
    if (next && !state.unlockedTracks.includes(next.id)) {
      state.unlockedTracks.push(next.id);
      unlocked.push({ kind: 'track', id: next.id, name: next.name });
    }
  }
  for (const car of cars) {
    if (car.unlock === trackId && place <= 3 && !state.unlockedCars.includes(car.id)) {
      state.unlockedCars.push(car.id);
      unlocked.push({ kind: 'car', id: car.id, name: car.name });
    }
  }
  save(state);
  return unlocked;
}
