// Player settings: volumes (music, effects, engine), units and the things some people would rather
// switch off. Kept apart from progress, so wiping progress keeps them.

const KEY = 'chrome-circuit-settings-v1';

export const VOLUMES = [0, 0.25, 0.5, 0.75, 1];

const defaults = () => ({
  music: 0.75,     // the soundtrack, share of full
  sfx: 1,          // sound effects, share of full
  engine: 1,       // the engine note and tyre squeal
  units: 'kmh',    // or 'mph'
  ghost: true,     // show the time trial ghost
  vibration: true, // pad rumble and phone vibration
  shake: true,     // camera shake on hits and landings
});

export function load() {
  const d = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return d;
    return {
      music: VOLUMES.includes(raw.music) ? raw.music : d.music,
      sfx: VOLUMES.includes(raw.sfx) ? raw.sfx : d.sfx,
      engine: VOLUMES.includes(raw.engine) ? raw.engine : d.engine,
      units: raw.units === 'mph' ? 'mph' : 'kmh',
      ghost: typeof raw.ghost === 'boolean' ? raw.ghost : d.ghost,
      vibration: typeof raw.vibration === 'boolean' ? raw.vibration : d.vibration,
      shake: typeof raw.shake === 'boolean' ? raw.shake : d.shake,
    };
  } catch {
    return d;
  }
}

export function save(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}
