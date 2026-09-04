// Persisted progression: unlocked circuits, unlocked cars, best lap times.
const KEY = 'chrome-circuit-progress-v1';

const blank = () => ({ unlockedTracks: ['downtown'], unlockedCars: [], best: {}, places: {}, difficulty: 0 });

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    // Valid JSON is not necessarily valid progress — a wrong-typed field
    // here would crash the boot sequence, so each one must earn its place.
    const p = JSON.parse(raw);
    const d = blank();
    return {
      unlockedTracks: Array.isArray(p.unlockedTracks)
        ? [...new Set([...d.unlockedTracks, ...p.unlockedTracks])]
        : d.unlockedTracks,
      unlockedCars: Array.isArray(p.unlockedCars) ? p.unlockedCars : d.unlockedCars,
      best: isObj(p.best) ? p.best : d.best,
      places: isObj(p.places) ? p.places : d.places,
      difficulty: [0, 1, 2, 3].includes(p.difficulty) ? p.difficulty : d.difficulty,
    };
  } catch {
    return blank();
  }
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

/** Record a finished race and return what it unlocked. */
export function record(state, { trackId, place, bestLap, tracks, cars }) {
  const unlocked = [];
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
