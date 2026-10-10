// The soundtrack: a title song for the menus, one for picking a car and a
// circuit, a song per circuit, the ghost's own for time trials, and songs
// for how a race went. Songs are decoded whole and looped as Web Audio
// buffers — an <audio> element leaves a gap at every loop, and these are
// written to go round without one — into the music bus (audio.js), so the
// mute button and the volume setting reach them. One song cross-fades into
// the next as the screens change.
import * as audio from './audio.js';

/** Every song by its slug: assets/music/{slug}.mp3 (tools/encode_music.py). */
export const SONGS = {
  karts: 'KARTS!',
  'choose-your-racer': 'Choose Your Racer',
  'ghost-trials': 'Ghost Trials',
  'race-results': 'Race Results',
  'you-won': 'You Won!',
  'you-lost': 'You Lost',
  'highway-hustle': 'Highway Hustle',
  'palmtree-square': 'Palmtree Square',
  'retro-roundabout': 'Retro Roundabout',
  'flowey-speedway': 'Flowey Speedway',
  'stadium-64': 'Stadium 64',
  'rainbow-way': 'Rainbow Way',
  'bouncing-pyramids': 'Bouncing Pyramids',
};

/** What plays on each circuit. */
const CIRCUIT_SONGS = {
  downtown: 'highway-hustle', harbour: 'palmtree-square', neon: 'retro-roundabout',
  sakura: 'flowey-speedway', greenhill: 'stadium-64', pinecrest: 'highway-hustle',
  frostvale: 'rainbow-way', glacier: 'retro-roundabout', summit: 'stadium-64',
  mesa: 'bouncing-pyramids', dustbowl: 'palmtree-square', canyonrun: 'rainbow-way',
};

/** Songs that play once and then hand over to another, rather than loop. */
const THEN = { 'you-lost': 'race-results' };

export const circuitSong = (trackId) => CIRCUIT_SONGS[trackId] || 'highway-hustle';

// Under the sound effects, which carry the race.
const MIX = 0.6;
const FADE = 0.9;
// The final lap runs the song a touch faster, and higher, like the arcades.
const FINAL_LAP_RATE = 1.06;
// A decoded song is some 15–35 MB; keep only the last few.
const KEEP = 3;

const decoded = new Map();   // slug -> Promise<AudioBuffer>, oldest first
let current = null;          // { id, gain, src, rate }
let duck = 1;

function load(id) {
  let p = decoded.get(id);
  if (p) decoded.delete(id);  // to the back of the queue
  else {
    p = fetch(`assets/music/${id}.mp3`)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((bytes) => audio.context().decodeAudioData(bytes));
    p.catch(() => decoded.delete(id));
  }
  decoded.set(id, p);
  while (decoded.size > KEEP) decoded.delete(decoded.keys().next().value);
  return p;
}

function level(v, to, time = FADE) {
  const t = audio.context().currentTime;
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setTargetAtTime(to, t, time / 3);
}

function begin(v, buffer) {
  const c = audio.context();
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.loop = !THEN[v.id];
  src.playbackRate.value = v.rate;
  src.connect(v.gain);
  if (!src.loop) src.onended = () => { if (current === v) play(THEN[v.id]); };
  src.start();
  v.src = src;
  level(v, MIX * duck);
}

function retire(v) {
  level(v, 0);
  setTimeout(() => {
    if (v.src) { v.src.onended = null; try { v.src.stop(); } catch { /* never started */ } }
    v.gain.disconnect();
  }, FADE * 1500);
}

/** Cross-fade to a song, or to silence with null. The same song carries on. */
export function play(id) {
  if (current?.id === id) return;
  if (current) retire(current);
  current = null;
  if (!id || !SONGS[id]) return;
  const gain = audio.context().createGain();
  gain.gain.value = 0;
  gain.connect(audio.musicBus());
  const v = current = { id, gain, src: null, rate: 1 };
  // A song that will not load leaves silence, not an error.
  load(id).then((buffer) => { if (current === v) begin(v, buffer); }, () => {});
}

/** The song on now, and whether it is sounding yet (it may still be loading). */
export function nowPlaying() {
  return current && { id: current.id, started: !!current.src, rate: current.rate };
}

/** Quieter under the pause menu; back up when racing on. */
export function setDucked(on) {
  duck = on ? 0.35 : 1;
  if (current) level(current, MIX * duck, 0.4);
}

/** The race's song speeds up for the last lap. */
export function finalLap() {
  if (!current) return;
  current.rate = FINAL_LAP_RATE;
  current.src?.playbackRate.setTargetAtTime(FINAL_LAP_RATE, audio.context().currentTime, 0.3);
}
