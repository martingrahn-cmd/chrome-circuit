// What there is to win, and how much of it has been: medals from the time
// trials, championship titles per world and level, the cars, and whether
// the game is beaten — every world's title on Pro or harder.
import { TRACKS, WORLDS, medalFor } from './tracks.js';
import { RACERS } from './roster.js';

export const LEVEL_NAMES = ['Rookie', 'Pro', 'Ace', 'Legend'];
/** The level the ending asks for in every world. */
export const ENDING_LEVEL = 1;

/** A world's championship titles: the best final place on each level, or null. */
function cups(progress, worldId) {
  return LEVEL_NAMES.map((_, d) => progress.champBest[`${worldId}:${d}`] ?? null);
}

/** The game is beaten once every world's title is won on Pro or harder. */
export function gameComplete(progress) {
  return WORLDS.every((w) => cups(progress, w.id).some((place, d) => d >= ENDING_LEVEL && place === 1));
}

export function summary(progress) {
  const worlds = WORLDS.map((w) => {
    const tracks = TRACKS.filter((t) => t.world === w.id).map((def) => {
      const trial = progress.trials[def.id]?.time ?? null;
      return { def, trial, medal: medalFor(def, trial), place: progress.places[def.id] ?? null, best: progress.best[def.id] ?? null };
    });
    return { id: w.id, name: w.name, cups: cups(progress, w.id), tracks, won: cups(progress, w.id).some((p, d) => d >= ENDING_LEVEL && p === 1) };
  });
  const all = worlds.flatMap((w) => w.tracks);
  // A gold counts all three medals: it beat silver's and bronze's times too.
  const medals = all.reduce((n, t) => n + (t.medal >= 0 ? 3 - t.medal : 0), 0);
  const gold = all.filter((t) => t.medal === 0).length;
  const titles = worlds.reduce((n, w) => n + w.cups.filter((p) => p === 1).length, 0);
  const unlockable = RACERS.filter((r) => r.unlock);
  const cars = unlockable.filter((r) => progress.unlockedCars.includes(r.id)).length;
  const max = {
    medals: all.length * 3, gold: all.length, titles: WORLDS.length * LEVEL_NAMES.length,
    cars: unlockable.length, garage: RACERS.length,
  };
  // Titles weigh most, then cars, then medals one by one.
  const score = medals + titles * 3 + cars * 2;
  const top = max.medals + max.titles * 3 + max.cars * 2;
  return {
    worlds, medals, gold, titles, cars,
    garage: RACERS.length - unlockable.length + cars,   // cars you can drive
    max,
    percent: Math.floor((score / top) * 100),
    complete: gameComplete(progress),
  };
}

/** What the trophies (achievements.js) need to know from the saved progress. */
export function facts(progress) {
  const t = summary(progress);
  const all = t.worlds.flatMap((w) => w.tracks);
  return {
    tracks: all.length,
    medalTracks: all.filter((r) => r.medal >= 0).length,
    goldTracks: t.gold,
    titles: t.titles,
    legendTitle: t.worlds.some((w) => w.cups[3] === 1),
    allCars: t.cars >= t.max.cars,
    allTracks: TRACKS.every((d) => progress.unlockedTracks.includes(d.id)),
    complete: t.complete,
  };
}
