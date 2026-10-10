// A time trial ghost in a link, to challenge a friend: no server, the whole
// lap rides in the link's #fragment (which never leaves the browser).
//
// A ghost is `{ time, car, s }`, `s` being six numbers a sample: time into
// the lap, x, y, z, heading and lap distance (race.js). For a link it is
// thinned to every other sample (7.5 a second is plenty to drive a ghost),
// quantised (10 cm, 1/50 rad, 1/120 s), stored as differences from the
// sample before, which mostly fit a byte, then deflated. Lap distance is
// left out; the race works it out again from the track. A lap
// becomes about 1–1.5 KB of link, short enough for any chat.

const VERSION = 1;
const STEP = 2;                 // keep every other sample
const Q = { t: 120, xyz: 10, h: 50 };

/* ---------------------------------------------------------- bytes */

function writer() {
  const bytes = [];
  const u = (n) => {           // unsigned varint
    n = Math.max(0, Math.round(n));
    while (n >= 0x80) { bytes.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
    bytes.push(n);
  };
  const i = (n) => { n = Math.round(n); u(n < 0 ? -2 * n - 1 : 2 * n); };   // zigzag
  const str = (s) => { u(s.length); for (const c of s) bytes.push(c.charCodeAt(0) & 0x7f); };
  return { bytes, u, i, str };
}

function reader(bytes) {
  let at = 0;
  const u = () => {
    let n = 0, mul = 1, b;
    do {
      if (at >= bytes.length) throw new Error('short');
      b = bytes[at++];
      n += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    return n;
  };
  const i = () => { const z = u(); return z % 2 ? -(z + 1) / 2 : z / 2; };
  const str = () => {
    const len = u();
    if (len > 40) throw new Error('long');
    let s = '';
    for (let k = 0; k < len; k++) s += String.fromCharCode(bytes[at++]);
    return s;
  };
  return { u, i, str, done: () => at >= bytes.length };
}

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function squeeze(bytes, way) {
  const Stream = way === 'in' ? globalThis.CompressionStream : globalThis.DecompressionStream;
  const stream = new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ------------------------------------------------------------- the link */

/** The ghost as a link's payload: base64url, URL-safe as it is. */
export async function encodeGhost(trackId, ghost) {
  const w = writer();
  w.str(trackId);
  w.str(ghost.car);
  w.u(ghost.time * 1000);
  const s = ghost.s, n = s.length / 6;
  const picks = [];
  for (let k = 0; k < n; k += STEP) picks.push(k);
  if (picks[picks.length - 1] !== n - 1) picks.push(n - 1);
  w.u(picks.length);
  let prev = [0, 0, 0, 0, 0];
  for (const k of picks) {
    const o = k * 6;
    const q = [s[o] * Q.t, s[o + 1] * Q.xyz, s[o + 2] * Q.xyz, s[o + 3] * Q.xyz, s[o + 4] * Q.h].map(Math.round);
    q.forEach((v, j) => w.i(v - prev[j]));
    prev = q;
  }
  const raw = Uint8Array.from(w.bytes);
  const packed = globalThis.CompressionStream ? await squeeze(raw, 'in') : raw;
  return toB64([VERSION, packed === raw ? 0 : 1, ...packed]);
}

/** Back from a payload: `{ trackId, ghost }` with lap distance still to
 *  fill in (fillDistance), or throws on anything that does not add up. */
export async function decodeGhost(payload, { tracks, cars }) {
  if (typeof payload !== 'string' || payload.length > 12000 || !/^[\w-]+$/.test(payload)) throw new Error('bad link');
  const all = fromB64(payload);
  if (all[0] !== VERSION) throw new Error('version');
  const body = all.subarray(2);
  const bytes = all[1] ? await squeeze(body, 'out') : body;
  const r = reader(bytes);
  const trackId = r.str(), car = r.str(), time = r.u() / 1000;
  if (!tracks.includes(trackId) || !cars.includes(car)) throw new Error('unknown track or car');
  if (!(time > 5 && time < 600)) throw new Error('time');
  const count = r.u();
  if (count < 10 || count > 6000) throw new Error('count');
  const s = [];
  let q = [0, 0, 0, 0, 0];
  for (let k = 0; k < count; k++) {
    q = q.map((v) => v + r.i());
    s.push(q[0] / Q.t, q[1] / Q.xyz, q[2] / Q.xyz, q[3] / Q.xyz, q[4] / Q.h, NaN);
  }
  if (!s.every((v, k) => k % 6 === 5 || Number.isFinite(v))) throw new Error('numbers');
  return { trackId, ghost: { time, car, s, shared: true } };
}

/** Lap distance for a ghost from a link, from where each sample stood on the
 *  track's line; never backwards, since the race looks it up in order. */
export function fillDistance(ghost, track) {
  const line = track.line, n = line.n, s = ghost.s;
  let hint = null, last = 0;
  for (let o = 0; o < s.length; o += 6) {
    const at = line.locate(s[o + 1], s[o + 3], hint, 30);
    hint = at.index;
    const d = ((((at.progress - track.startIndex) % n) + n) % n) * line.spacing;
    // Just after the line the lap distance can read as a whole lap; it is 0.
    last = o === 0 && d > line.length / 2 ? 0 : Math.max(last, d);
    s[o + 5] = last;
  }
  return ghost;
}

export function ghostLink(payload) {
  return `${location.origin}${location.pathname}#ghost=${payload}`;
}

export function payloadFromHash(hash = location.hash) {
  const m = /^#ghost=([\w-]+)$/.exec(hash || '');
  return m ? m[1] : null;
}
