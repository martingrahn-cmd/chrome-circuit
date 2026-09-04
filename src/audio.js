// Synthesised engine note and sound effects via Web Audio. No asset files.
let ctx = null;
let master = null;
let enabled = true;
let volume = 0.7;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    // Respect a mute toggled before the context existed.
    master.gain.value = enabled ? volume : 0;
    master.connect(ctx.destination);
  }
  return ctx;
}

export function unlock() {
  const c = ac();
  if (c.state === 'suspended') c.resume();
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = enabled ? v : 0;
}

export function setEnabled(on) {
  enabled = on;
  if (master) master.gain.value = on ? volume : 0;
}

export function isEnabled() { return enabled; }
export function getVolume() { return volume; }

function noiseBuffer(seconds = 1) {
  const c = ac();
  const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

let sharedNoise = null;
function noise() {
  if (!sharedNoise) sharedNoise = noiseBuffer(2);
  const src = ac().createBufferSource();
  src.buffer = sharedNoise;
  src.loop = true;
  return src;
}

export function tone({ freq = 440, type = 'square', dur = 0.15, gain = 0.2, sweep = null, delay = 0 }) {
  if (!enabled) return;
  const c = ac();
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

export function thump({ dur = 0.32, gain = 0.5, cutoff = 900, delay = 0 }) {
  if (!enabled) return;
  const c = ac();
  const t = c.currentTime + delay;
  const src = noise();
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(cutoff, t);
  f.frequency.exponentialRampToValueAtTime(120, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.05);
}

export const sfx = {
  countdown: () => tone({ freq: 520, type: 'square', dur: 0.18, gain: 0.22 }),
  go: () => {
    tone({ freq: 780, type: 'square', dur: 0.5, gain: 0.26 });
    tone({ freq: 1170, type: 'square', dur: 0.5, gain: 0.14, delay: 0.02 });
    // The lights go out with a kick you feel, not just a beep you hear.
    thump({ dur: 0.7, gain: 0.8, cutoff: 1600 });
    tone({ freq: 70, sweep: 240, type: 'sawtooth', dur: 0.6, gain: 0.22 });
  },
  pickup: () => {
    [660, 880, 1180].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.12, gain: 0.18, delay: i * 0.05 }));
  },
  // Slot already full: a flat two-note "nope".
  denied: () => {
    [300, 240].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.09, gain: 0.13, delay: i * 0.08 }));
  },
  boost: () => {
    tone({ freq: 220, sweep: 1400, type: 'sawtooth', dur: 0.55, gain: 0.2 });
    thump({ dur: 0.5, gain: 0.28, cutoff: 2600 });
  },
  missile: () => {
    // Launch: a chest thump first, the whoosh riding on top of it.
    thump({ dur: 0.55, gain: 0.7, cutoff: 1100 });
    tone({ freq: 130, sweep: 36, type: 'square', dur: 0.4, gain: 0.3 });
    tone({ freq: 1400, sweep: 300, type: 'sawtooth', dur: 0.42, gain: 0.13, delay: 0.03 });
  },
  explode: () => {
    thump({ dur: 0.55, gain: 0.6, cutoff: 1800 });
    tone({ freq: 140, sweep: 40, type: 'square', dur: 0.4, gain: 0.24 });
  },
  bump: (strength = 0.5) => thump({ dur: 0.16, gain: 0.18 + strength * 0.32, cutoff: 1400 }),
  wall: () => thump({ dur: 0.22, gain: 0.32, cutoff: 700 }),
  lap: () => {
    [880, 1100].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.2, gain: 0.2, delay: i * 0.09 }));
  },
  finish: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.3, gain: 0.2, delay: i * 0.1 }));
  },
  select: () => tone({ freq: 720, type: 'square', dur: 0.07, gain: 0.14 }),
  back: () => tone({ freq: 320, type: 'square', dur: 0.09, gain: 0.13 }),
};

/** Continuous engine note driven by speed, load and surface. */
export class EngineSound {
  constructor() {
    this.started = false;
  }

  start() {
    // Mute is enforced by the master gain, so build the graph regardless —
    // otherwise unmuting mid-race can never bring the engine note back.
    if (this.started) return;
    const c = ac();
    this.osc = c.createOscillator();
    this.osc2 = c.createOscillator();
    this.filter = c.createBiquadFilter();
    this.gain = c.createGain();
    this.skidSrc = noise();
    this.skidFilter = c.createBiquadFilter();
    this.skidGain = c.createGain();

    this.osc.type = 'sawtooth';
    this.osc2.type = 'square';
    this.osc2.detune.value = -1200;
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1100;
    this.filter.Q.value = 3;
    this.gain.gain.value = 0;

    this.osc.connect(this.filter);
    this.osc2.connect(this.filter);
    this.filter.connect(this.gain);
    this.gain.connect(master);

    this.skidFilter.type = 'bandpass';
    this.skidFilter.frequency.value = 2600;
    this.skidFilter.Q.value = 1.4;
    this.skidGain.gain.value = 0;
    this.skidSrc.connect(this.skidFilter);
    this.skidFilter.connect(this.skidGain);
    this.skidGain.connect(master);

    this.osc.start();
    this.osc2.start();
    this.skidSrc.start();
    this.started = true;
  }

  stop() {
    if (!this.started) return;
    try { this.osc.stop(); this.osc2.stop(); this.skidSrc.stop(); } catch { /* already stopped */ }
    this.started = false;
  }

  update(speedRatio, throttle, slip, boosting) {
    if (!this.started) return;
    const c = ac();
    const t = c.currentTime;
    const base = 58 + speedRatio * 190 + (boosting ? 40 : 0);
    this.osc.frequency.setTargetAtTime(base, t, 0.04);
    this.osc2.frequency.setTargetAtTime(base * 0.5, t, 0.06);
    this.filter.frequency.setTargetAtTime(500 + speedRatio * 2600 + throttle * 500, t, 0.06);
    const load = 0.055 + throttle * 0.055 + speedRatio * 0.05;
    this.gain.gain.setTargetAtTime(load, t, 0.07);
    this.skidGain.gain.setTargetAtTime(slip * 0.11, t, 0.05);
    this.skidFilter.frequency.setTargetAtTime(1800 + slip * 2200, t, 0.05);
  }
}
