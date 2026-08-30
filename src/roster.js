// The starting grid. Stats are deliberately spread so car choice matters.
export const RACERS = [
  { id: 'comet',   name: 'Comet',    model: 'race',              engine: 17.5, topSpeed: 28.5, handling: 2.72, mass: 1.0,  colour: '#ef4444', blurb: 'Balanced works.' },
  { id: 'vector',  name: 'Vector',   model: 'race-future',       engine: 15.6, topSpeed: 31.0, handling: 2.44, mass: 1.05, blurb: 'Top speed, lazy turn-in.', colour: '#38bdf8' },
  { id: 'blaze',   name: 'Blaze',    model: 'sedan-sports',      engine: 17.0, topSpeed: 28.0, handling: 2.68, mass: 1.1,  colour: '#f97316', blurb: 'The all-rounder.' },
  { id: 'pixie',   name: 'Pixie',    model: 'hatchback-sports',  engine: 18.4, topSpeed: 26.4, handling: 3.02, mass: 0.92, colour: '#a3e635', blurb: 'Points anywhere. Slow on straights.' },
  { id: 'siren',   name: 'Siren',    model: 'police',            engine: 19.2, topSpeed: 27.2, handling: 2.62, mass: 1.15, colour: '#60a5fa', blurb: 'Ferocious off the line.' },
  { id: 'meter',   name: 'Meter',    model: 'taxi',              engine: 16.4, topSpeed: 27.0, handling: 2.66, mass: 1.15, colour: '#facc15', blurb: 'Knows every shortcut.' },
  { id: 'boulder', name: 'Boulder',  model: 'suv',               engine: 15.2, topSpeed: 27.6, handling: 2.34, mass: 1.5,  colour: '#22c55e', blurb: 'Shrugs off contact.' },
  { id: 'hauler',  name: 'Hauler',   model: 'van',               engine: 14.6, topSpeed: 27.8, handling: 2.28, mass: 1.62, colour: '#c084fc', blurb: 'A wall with wheels.' },
  { id: 'oobi',    name: 'Oobi',     model: 'kart-oobi',         engine: 19.8, topSpeed: 25.6, handling: 3.16, mass: 0.8,  colour: '#fb7185', blurb: 'Tiny. Furious.', unlock: 'sakura' },
  { id: 'oozi',    name: 'Oozi',     model: 'kart-oozi',         engine: 18.6, topSpeed: 26.8, handling: 3.06, mass: 0.82, colour: '#2dd4bf', blurb: 'Kart physics, race pace.', unlock: 'neon' },
];

export function racerById(id) {
  return RACERS.find((r) => r.id === id) || RACERS[0];
}
