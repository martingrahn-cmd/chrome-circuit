// Championship: every circuit in turn against the same five rivals, points
// per finish. Pure bookkeeping — no DOM, no rendering — so it can be saved
// with the rest of the progress and picked up again after a reload.

export const POINTS = [10, 7, 5, 3, 2, 1];

/** A fresh championship. `rounds` is the circuit order, stored so a saved
 *  championship still makes sense if circuits are added later. */
export function create({ difficulty, racerId, rivals, rounds }) {
  const field = [racerId, ...rivals];
  return {
    difficulty,
    racerId,
    rivals: [...rivals],
    rounds: [...rounds],
    round: 0,
    points: Object.fromEntries(field.map((id) => [id, 0])),
    places: Object.fromEntries(field.map((id) => [id, []])),
  };
}

export function isOver(champ) {
  return champ.round >= champ.rounds.length;
}

/** Book one race: `results` in finishing order, each with the car's `id`.
 *  Returns the points each car took, by id. */
export function score(champ, results) {
  const gained = {};
  results.forEach((r, i) => {
    if (!(r.id in champ.points)) return;
    const pts = POINTS[i] ?? 0;
    champ.points[r.id] += pts;
    champ.places[r.id].push(i + 1);
    gained[r.id] = pts;
  });
  champ.round += 1;
  return gained;
}

/** The table, leader first. Ties go to more wins, then more seconds and so
 *  on, then to whoever finished ahead in the latest round. */
export function standings(champ) {
  const rows = Object.keys(champ.points).map((id) => ({
    id,
    points: champ.points[id],
    places: champ.places[id],
    isPlayer: id === champ.racerId,
  }));
  const count = (row, p) => row.places.filter((x) => x === p).length;
  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    for (let p = 1; p <= POINTS.length; p++) {
      const d = count(b, p) - count(a, p);
      if (d) return d;
    }
    return (a.places.at(-1) ?? 99) - (b.places.at(-1) ?? 99);
  });
  return rows;
}

/** A saved championship, checked field by field — a malformed one must not
 *  crash the boot, it is simply dropped. */
export function validate(raw, knownCars, knownTracks) {
  if (!raw || typeof raw !== 'object') return null;
  const { difficulty, racerId, rivals, rounds, round, points, places } = raw;
  if (![0, 1, 2, 3].includes(difficulty)) return null;
  if (!knownCars.includes(racerId)) return null;
  if (!Array.isArray(rivals) || !rivals.length || !rivals.every((id) => knownCars.includes(id))) return null;
  if (!Array.isArray(rounds) || !rounds.length || !rounds.every((id) => knownTracks.includes(id))) return null;
  if (!Number.isInteger(round) || round < 0 || round > rounds.length) return null;
  const field = [racerId, ...rivals];
  for (const id of field) {
    if (!Number.isFinite(points?.[id])) return null;
    if (!Array.isArray(places?.[id]) || places[id].length !== round) return null;
  }
  return { difficulty, racerId, rivals: [...rivals], rounds: [...rounds], round, points: { ...points }, places: { ...places } };
}
