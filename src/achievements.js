// The 31 trophies, to the GameVolt standard: 15 bronze for natural play,
// 10 silver for skill and dedication, 5 gold for the hardcore, and the
// platinum for having all the others.
//
// The core is pure: race events update a bag of numbers (`onEvent`), and
// `evaluate` reads those and a few facts from the saved progress (medals,
// titles, what is unlocked) and says what has been newly earned. Everything
// that touches localStorage, the GameVolt SDK or the screen sits below it,
// guarded, so the game plays the same with or without GameVolt around it.

export const GAME_ID = 'chrome-circuit';

export const TROPHIES = [
  // ---- bronze (15): natural play ----
  { id: 'first_race', name: 'Green Light', desc: 'Finish your first race', icon: '🚦', tier: 'bronze', cond: (s) => s.races >= 1 },
  { id: 'first_podium', name: 'On the Box', desc: 'Finish a race in the top three', icon: '🥉', tier: 'bronze', cond: (s) => s.podiums >= 1 },
  { id: 'first_win', name: 'Chequered Flag', desc: 'Win a race', icon: '🏁', tier: 'bronze', cond: (s) => s.wins >= 1 },
  { id: 'rocket_start', name: 'Rocket Start', desc: 'Hit the gas as the lights go green', icon: '🚀', tier: 'bronze', cond: (s) => s.rocket_starts >= 1 },
  { id: 'drift_boost', name: 'Sideways', desc: 'Earn a drift boost', icon: '💨', tier: 'bronze', cond: (s) => s.drift_boosts >= 1 },
  { id: 'orange_sparks', name: 'Orange Sparks', desc: 'Hold a drift long enough for an orange boost', icon: '🔥', tier: 'bronze', cond: (s) => s.orange_boosts >= 1 },
  { id: 'big_air', name: 'Big Air', desc: 'Fly for more than half a second', icon: '🪂', tier: 'bronze', cond: (s) => s.big_airs >= 1 },
  { id: 'direct_hit', name: 'Direct Hit', desc: 'Hit a rival with a rocket', icon: '🎯', tier: 'bronze', cond: (s) => s.rocket_hits >= 1 },
  { id: 'slippery', name: 'Slippery', desc: 'Spin a rival with your oil drum', icon: '🛢️', tier: 'bronze', cond: (s) => s.oil_spins >= 1 },
  { id: 'close_call', name: 'Close Call', desc: 'Shave past a rival without touching', icon: '😬', tier: 'bronze', cond: (s) => s.close_calls >= 1 },
  { id: 'overtakes_25', name: 'Through the Field', desc: 'Overtake 25 cars', icon: '⏩', tier: 'bronze', cond: (s) => s.overtakes >= 25 },
  { id: 'ghost_rider', name: 'Ghost Rider', desc: 'Set a lap in time trial', icon: '👻', tier: 'bronze', cond: (s) => s.trial_laps >= 1 },
  { id: 'bronze_medal', name: 'Medalist', desc: 'Earn a time trial medal', icon: '🎖️', tier: 'bronze', cond: (s, f) => f.medalTracks >= 1 },
  { id: 'snow_chains', name: 'Snow Chains', desc: 'Finish a race in Alpine Winter', icon: '❄️', tier: 'bronze', cond: (s) => s.alps_races >= 1 },
  { id: 'red_dust', name: 'Red Dust', desc: 'Finish a race in Red Rock Canyon', icon: '🌵', tier: 'bronze', cond: (s) => s.canyon_races >= 1 },
  // ---- silver (10): skill and dedication ----
  { id: 'wins_10', name: 'Winning Habit', desc: 'Win 10 races', icon: '🏆', tier: 'silver', cond: (s) => s.wins >= 10 },
  { id: 'hat_trick', name: 'Hat Trick', desc: 'Win 3 races in a row', icon: '🎩', tier: 'silver', cond: (s) => s.best_streak >= 3 },
  { id: 'runaway', name: 'Runaway', desc: 'Win a race by 5 seconds or more', icon: '🏃', tier: 'silver', cond: (s) => s.runaways >= 1 },
  { id: 'ace_win', name: 'Ace Driver', desc: 'Win a race on Ace or Legend', icon: '♠️', tier: 'silver', cond: (s) => s.ace_wins >= 1 },
  { id: 'champion', name: 'Champion', desc: 'Win a championship', icon: '🥇', tier: 'silver', cond: (s, f) => f.titles >= 1 },
  { id: 'gold_medal', name: 'Gold Standard', desc: 'Earn a gold medal in time trial', icon: '🌟', tier: 'silver', cond: (s, f) => f.goldTracks >= 1 },
  { id: 'medal_every', name: 'Full Set', desc: 'Earn a medal on every circuit', icon: '🗺️', tier: 'silver', cond: (s, f) => f.medalTracks >= f.tracks },
  { id: 'full_garage', name: 'Full Garage', desc: 'Unlock every car', icon: '🚗', tier: 'silver', cond: (s, f) => f.allCars },
  { id: 'open_road', name: 'Open Road', desc: 'Unlock every circuit in the career', icon: '🛣️', tier: 'silver', cond: (s, f) => f.allTracks },
  { id: 'drift_king', name: 'Drift King', desc: 'Earn 100 drift boosts', icon: '👑', tier: 'silver', cond: (s) => s.drift_boosts >= 100 },
  // ---- gold (5): for the hardcore ----
  { id: 'grand_champion', name: 'Grand Champion', desc: "Win every world's championship on Pro or harder", icon: '🏆', tier: 'gold', cond: (s, f) => f.complete },
  { id: 'clean_sweep', name: 'Clean Sweep', desc: 'Win every round of a championship on Pro or harder', icon: '🧹', tier: 'gold', cond: (s) => s.sweeps >= 1 },
  { id: 'legend_title', name: 'Living Legend', desc: 'Win a championship on Legend', icon: '🔱', tier: 'gold', cond: (s, f) => f.legendTitle },
  { id: 'gold_rush', name: 'Gold Rush', desc: 'Earn gold on every circuit', icon: '💰', tier: 'gold', cond: (s, f) => f.goldTracks >= f.tracks },
  { id: 'legend_tour', name: 'Legend of the Road', desc: 'Win on Legend on every circuit', icon: '🛞', tier: 'gold', cond: (s, f) => s.legend_tracks.length >= f.tracks },
  // ---- platinum (1): every other trophy ----
  { id: 'master', name: 'Chrome Circuit Master', desc: 'Unlock all 30 other trophies', icon: '💎', tier: 'platinum', cond: null },
];

export const TIERS = ['bronze', 'silver', 'gold', 'platinum'];

const DEFAULTS = {
  races: 0, wins: 0, podiums: 0, win_streak: 0, best_streak: 0, runaways: 0, ace_wins: 0,
  rocket_starts: 0, drift_boosts: 0, orange_boosts: 0, big_airs: 0, rocket_hits: 0, oil_spins: 0,
  close_calls: 0, overtakes: 0, trial_laps: 0, alps_races: 0, canyon_races: 0, sweeps: 0,
  legend_tracks: [],
};

export function freshStats() {
  return { ...DEFAULTS, legend_tracks: [] };
}

/** A saved bag of stats, field by field: anything wrong-typed is reset. */
export function cleanStats(raw) {
  const s = freshStats();
  if (!raw || typeof raw !== 'object') return s;
  for (const k of Object.keys(DEFAULTS)) {
    if (k === 'legend_tracks') {
      if (Array.isArray(raw[k])) s[k] = [...new Set(raw[k].filter((v) => typeof v === 'string'))];
    } else if (Number.isFinite(raw[k]) && raw[k] >= 0) {
      s[k] = raw[k];
    }
  }
  return s;
}

/**
 * Fold one event into the stats.
 *   finish  { place, trackId, world, difficulty, margin } — a race, not a time trial
 *   champ   { place, difficulty, sweep }                 — a championship's last round
 *   launch, close, overtake, hit, oil                     — moments in a race
 *   boost   { level }   air { time }   trial              — likewise
 */
export function onEvent(s, name, d = {}) {
  switch (name) {
    case 'finish':
      s.races++;
      if (d.world === 'alps') s.alps_races++;
      if (d.world === 'canyon') s.canyon_races++;
      if (d.place <= 3) s.podiums++;
      if (d.place === 1) {
        s.wins++;
        s.win_streak++;
        s.best_streak = Math.max(s.best_streak, s.win_streak);
        if (d.margin >= 5) s.runaways++;
        if (d.difficulty >= 2) s.ace_wins++;
        if (d.difficulty >= 3 && !s.legend_tracks.includes(d.trackId)) s.legend_tracks.push(d.trackId);
      } else {
        s.win_streak = 0;
      }
      break;
    case 'champ':
      if (d.place === 1 && d.sweep && d.difficulty >= 1) s.sweeps++;
      break;
    case 'launch': s.rocket_starts++; break;
    case 'boost':
      s.drift_boosts++;
      if (d.level >= 2) s.orange_boosts++;
      break;
    case 'air': s.big_airs++; break;
    case 'hit': s.rocket_hits++; break;
    case 'oil': s.oil_spins++; break;
    case 'close': s.close_calls++; break;
    case 'overtake': s.overtakes++; break;
    case 'trial': s.trial_laps++; break;
    default: break;
  }
  return s;
}

/** Ids newly earned, given the stats, facts from progress, and what is held. */
export function evaluate(s, facts, unlocked = []) {
  const have = new Set(unlocked);
  const earned = [];
  for (const t of TROPHIES) {
    if (have.has(t.id) || !t.cond) continue;
    if (t.cond(s, facts)) { earned.push(t.id); have.add(t.id); }
  }
  const others = TROPHIES.filter((t) => t.tier !== 'platinum');
  if (!have.has('master') && others.every((t) => have.has(t.id))) earned.push('master');
  return earned;
}

export const trophyById = (id) => TROPHIES.find((t) => t.id === id) || null;

/* -------------------------------------------------------- in the browser */

const LS_STATS = 'chrome-circuit-stats-v1';
const LS_UNLOCKED = 'chrome-circuit-trophies-v1';
const hasDom = typeof document !== 'undefined' && typeof localStorage !== 'undefined';
const sdk = () => (typeof window !== 'undefined' && window.GameVolt) || null;

export function loadStats() {
  if (!hasDom) return freshStats();
  try { return cleanStats(JSON.parse(localStorage.getItem(LS_STATS) || 'null')); } catch { return freshStats(); }
}
function saveStats(s) { if (hasDom) try { localStorage.setItem(LS_STATS, JSON.stringify(s)); } catch { /* private mode */ } }

export function getUnlocked() {
  if (!hasDom) return [];
  try {
    const a = JSON.parse(localStorage.getItem(LS_UNLOCKED) || '[]');
    return Array.isArray(a) ? a.filter((id) => trophyById(id)) : [];
  } catch { return []; }
}
function saveUnlocked(a) { if (hasDom) try { localStorage.setItem(LS_UNLOCKED, JSON.stringify(a)); } catch { /* private mode */ } }

/** Tell the GameVolt player page, when the game runs in its iframe. */
export function gvPost(action, payload) {
  if (typeof window === 'undefined' || window.parent === window) return;
  try { window.parent.postMessage({ type: 'gamevolt', action, gameId: GAME_ID, payload: payload || {} }, '*'); } catch { /* cross-origin */ }
}

let toastHook = null, chimeHook = null;
/** The game's own toast, for when GameVolt's is not there, and its chime. */
export function setToast(toast, chime) { toastHook = toast; chimeHook = chime; }

function unlock(id, silent) {
  const held = getUnlocked();
  if (held.includes(id)) return false;
  held.push(id);
  saveUnlocked(held);
  const GV = sdk();
  // Earned on another device already: keep it, but do not cheer twice.
  const cloudHas = !!GV?.achievements?.isUnlocked?.(id);
  if (GV?.achievements && !cloudHas) {
    try { GV.achievements.unlock(id); } catch { /* offline: the SDK keeps it */ }
  }
  const t = trophyById(id);
  if (!silent && !cloudHas && t) {
    gvPost('achievement', { id, name: t.name });
    chimeHook?.(t.tier);
    if (GV?.ui?.achievementToast) GV.ui.achievementToast({ icon: t.icon, name: t.name, tier: t.tier });
    else toastHook?.(t);
  }
  return true;
}

/** Fold an event in and unlock whatever it earned. Returns the new ids. */
export function event(name, data, facts) {
  const s = onEvent(loadStats(), name, data);
  saveStats(s);
  return check(facts, false, s);
}

/** Unlock what the stats and progress already earn — silently on boot, so
 *  a save from before the trophies existed gets its due without a parade. */
export function check(facts, silent = false, s = loadStats()) {
  const earned = evaluate(s, facts, getUnlocked());
  earned.forEach((id) => unlock(id, silent));
  return earned;
}

/** Pull trophies earned on another device into this one, quietly. */
function backfill() {
  const GV = sdk();
  if (!GV?.achievements?.getUnlockedIds) return;
  // A Set of this game's ids, without the game's prefix.
  GV.achievements.getUnlockedIds().then((ids) => {
    const mine = Array.from(ids || []).filter((id) => trophyById(id));
    const held = getUnlocked();
    const merged = [...new Set([...held, ...mine])];
    if (merged.length !== held.length) saveUnlocked(merged);
  }).catch(() => {});
}

/** Fetch the GameVolt SDK, only where it lives: on GameVolt itself. Anywhere
 *  else (GitHub Pages, a checkout) the game runs on its own. */
export function loadSDK() {
  if (typeof window === 'undefined' || window.GameVolt) return Promise.resolve(!!sdk());
  if (!/(^|\.)gamevolt\.io$/.test(location.hostname)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const tag = document.createElement('script');
    tag.src = '/sdk/gamevolt.js';
    tag.onload = () => resolve(!!sdk());
    tag.onerror = () => resolve(false);
    document.head.appendChild(tag);
  });
}

/** Hook into GameVolt when it is there: guest trophies follow the player
 *  into the cloud on sign-in, and the cloud's come back down. */
export function initSDK() {
  const GV = sdk();
  if (!GV) return;
  try {
    GV.init(GAME_ID);
    GV.save.registerMigration({
      keys: [LS_STATS, LS_UNLOCKED],
      merge: (local, cloud) => {
        // Counts only ever grow: keep the larger of each.
        let ls = {};
        try { ls = JSON.parse(local[LS_STATS] || '{}'); } catch { /* keep {} */ }
        const a = cleanStats(ls), b = cleanStats(cloud);
        const out = freshStats();
        for (const k of Object.keys(out)) {
          out[k] = k === 'legend_tracks' ? [...new Set([...a[k], ...b[k]])] : Math.max(a[k], b[k]);
        }
        return out;
      },
      getAchievements: (local) => {
        try {
          const ids = JSON.parse(local[LS_UNLOCKED] || '[]');
          return Array.isArray(ids) ? ids.map((id) => ({ id, unlocked_at: Date.now() })) : [];
        } catch { return []; }
      },
      getScores: () => [],
    });
    GV.auth.onStateChange((user) => { if (user) backfill(); });
  } catch { /* the game does not depend on it */ }
}
