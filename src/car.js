// Arcade vehicle: longitudinal/lateral velocity split in the car's own frame,
// which gives grip, understeer and proper power slides without a physics engine.
import * as THREE from 'three';
import { instance } from './assets.js';

export const SURFACE = {
  road: { grip: 15.5, maxSpeed: 1.0, drag: 1.0 },
  // Run-off beside a street circuit: dusty and slow, but still tarmac.
  kerb: { grip: 10.0, maxSpeed: 0.87, drag: 1.6 },
  dirt: { grip: 7.0, maxSpeed: 0.72, drag: 2.4 },
};

export class Car {
  constructor(spec, track, opts = {}) {
    this.spec = spec;
    this.track = track;
    this.isPlayer = !!opts.isPlayer;
    this.name = opts.name || spec.name;
    this.tint = opts.tint || '#ffffff';

    this.x = 0; this.z = 0;
    this.heading = 0;
    this.vLong = 0;
    this.vLat = 0;

    this.steer = 0;         // smoothed steering input
    this.throttle = 0;
    this.handbrake = false;
    // 0..1: how much of the run-off penalty this car is spared. Set on the
    // player by difficulty — a first-timer lives on the grass, and grass at
    // 72% top speed is why they finish last. Rivals get none.
    this.runoffEase = 0;

    this.engine = spec.engine;      // acceleration, units/s^2
    this.topSpeed = spec.topSpeed;  // units/s
    this.handling = spec.handling;  // rad/s at reference speed
    this.mass = spec.mass;

    this.surface = 'road';
    this.slip = 0;
    this.boost = 0;
    this.spin = 0;
    this.spinRate = 0;

    this.lap = 0;
    this.lineIndex = 0;
    this.progress = 0;
    this.totalProgress = 0;
    this.lapTimes = [];
    this.lapStart = 0;
    this.finished = false;
    this.finishTime = 0;
    this.racePosition = 1;
    this.item = null;
    this.draft = 0;

    this.object = new THREE.Group();
    this.body = instance('cars', spec.model);
    this.object.add(this.body);
    this.wheels = { fl: null, fr: null, bl: null, br: null };
    // Contact hull: a capsule down the length of the car, not one fat circle.
    // A single circle big enough to cover a 2.6-long car is 2.7 wide, which
    // makes two cars "touch" from two car-widths apart and kills overtaking.
    this.hullRadius = 0.72;
    this.hullAxle = 0.58;

    this.body.traverse((o) => {
      const n = (o.name || '').toLowerCase();
      if (n.includes('wheel-front-left')) this.wheels.fl = o;
      else if (n.includes('wheel-front-right')) this.wheels.fr = o;
      else if (n.includes('wheel-back-left')) this.wheels.bl = o;
      else if (n.includes('wheel-back-right')) this.wheels.br = o;
    });
    for (const w of Object.values(this.wheels)) if (w) w.userData.spin = 0;
    this.radius = 1.35;
  }

  placeAt(slot) {
    this.x = slot.x; this.z = slot.z;
    this.heading = slot.heading;
    this.lineIndex = slot.index;
    this.progress = slot.index;
    // The raw (un-wrapped) index keeps totalProgress on one shared baseline
    // across the whole grid; standings compare it directly between cars.
    this.totalProgress = (slot.raw ?? slot.index) - this.track.line.n;
    this.syncObject();
  }

  get speed() { return Math.hypot(this.vLong, this.vLat); }

  get forward() { return { x: Math.sin(this.heading), z: Math.cos(this.heading) }; }

  applyInput(throttle, steer, dt, handbrake = false) {
    this.throttle = throttle;
    this.handbrake = handbrake;
    const rate = this.isPlayer ? 9 : 7;
    this.steer += (steer - this.steer) * Math.min(1, rate * dt);
  }

  spinOut(duration = 1.15) {
    if (this.spin > 0) return;
    this.spin = duration;
    this.spinRate = (Math.random() < 0.5 ? -1 : 1) * 11;
    this.vLong *= 0.35;
    this.boost = 0;
  }

  giveBoost(duration = 2.0) {
    this.boost = Math.max(this.boost, duration);
  }

  update(dt) {
    const line = this.track.line;

    // --- Where are we relative to the racing line? -------------------------
    const loc = line.locate(this.x, this.z, this.lineIndex, 26);
    const prevIndex = this.lineIndex;
    this.lineIndex = loc.index;
    this.lateral = loc.lateral;

    let delta = loc.index - prevIndex;
    if (delta > line.n / 2) delta -= line.n;
    if (delta < -line.n / 2) delta += line.n;
    this.totalProgress += delta;

    const offTrack = loc.dist > this.track.roadHalf;
    this.surface = offTrack ? (this.track.walls ? 'kerb' : 'dirt') : 'road';
    const raw = SURFACE[this.surface];
    const ease = this.surface === 'road' ? 0 : this.runoffEase;
    const surf = ease > 0 ? {
      grip: raw.grip + (SURFACE.road.grip - raw.grip) * ease * 0.4,
      maxSpeed: raw.maxSpeed + (1 - raw.maxSpeed) * ease * 0.45,
      drag: raw.drag + (SURFACE.road.drag - raw.drag) * ease * 0.4,
    } : raw;

    // --- Spin-out overrides normal control --------------------------------
    if (this.spin > 0) {
      this.spin -= dt;
      this.heading += this.spinRate * dt;
      this.spinRate *= 1 - dt * 1.4;
      this.vLong *= 1 - dt * 2.2;
      this.vLat *= 1 - dt * 2.2;
    } else {
      const boosting = this.boost > 0;
      if (boosting) this.boost -= dt;

      // Tucking in behind someone is worth real speed on the straights.
      const tow = 1 + 0.14 * this.draft;
      const maxSpeed = this.topSpeed * surf.maxSpeed * (boosting ? 1.42 : 1) * tow;
      const power = this.engine * (boosting ? 2.0 : 1) * (1 + 0.3 * this.draft);

      if (this.throttle > 0) {
        const headroom = Math.max(0, 1 - this.vLong / maxSpeed);
        this.vLong += power * this.throttle * headroom * dt;
      } else if (this.throttle < 0) {
        // Scale by the input like the throttle branch does, so an analog
        // trigger can trail the brake instead of always locking up.
        const brake = -this.throttle;
        if (this.vLong > 0.4) this.vLong -= this.engine * 2.1 * brake * dt;
        else this.vLong = Math.max(-this.topSpeed * 0.32, this.vLong - this.engine * 0.7 * brake * dt);
      }

      // Steering authority ramps in with speed, then eases off at the top end.
      const sp = Math.abs(this.vLong);
      const authority = Math.min(1, sp / 7) * (1 - Math.min(0.34, sp / (this.topSpeed * 3.4)));
      const dir = this.vLong < -0.2 ? -1 : 1;
      // Handbrake: the rear lets go. The car rotates faster into the corner,
      // most of the grip goes so the slide carries, and it scrubs a little
      // speed — a drift, not a brake. Released, grip returns and the slide
      // straightens out on its own.
      const drifting = this.handbrake && sp > 3;
      // The Kenney models face +Z with their front-LEFT wheel on local +X, so
      // local +X is the car's left and a right-hand turn *lowers* the heading.
      const turn = -this.steer * this.handling * authority * dir * (drifting ? 1.35 : 1);
      this.heading += turn * dt;

      // Cornering throws weight to the outside of the turn; grip bleeds it off.
      this.vLat -= turn * this.vLong * dt;
      const gripLoss = Math.exp(-(drifting ? surf.grip * 0.26 : surf.grip) * dt);
      this.vLat *= gripLoss;

      // Drag and rolling resistance. Kept light: the throttle headroom term
      // above is what actually sets top speed.
      this.vLong -= (0.0012 * this.vLong * Math.abs(this.vLong) + surf.drag * this.vLong * 0.05) * dt;
      if (this.vLong > maxSpeed) this.vLong += (maxSpeed - this.vLong) * Math.min(1, dt * 3);

      if (drifting) {
        this.vLong *= 1 - dt * 0.55;
        // Sideways faster than three-quarters of forward is a spin, not a
        // slide — held as the last word on the step, after the run-off speed
        // clamp above has had its say on vLong.
        const maxLat = Math.abs(this.vLong) * 0.75;
        this.vLat = Math.max(-maxLat, Math.min(maxLat, this.vLat));
      }
    }

    this.slip = Math.min(1, Math.abs(this.vLat) / 5.5);

    // --- Integrate --------------------------------------------------------
    const f = this.forward;
    const rx = f.z, rz = -f.x; // the car's left axis (+vLat is leftward)
    this.x += (f.x * this.vLong + rx * this.vLat) * dt;
    this.z += (f.z * this.vLong + rz * this.vLat) * dt;

    // --- Track limits: soft push back inside the walls ---------------------
    const limit = this.track.wallHalf;
    const after = line.locate(this.x, this.z, this.lineIndex, 8);
    if (Math.abs(after.lateral) > limit) {
      const over = Math.abs(after.lateral) - limit;
      const sign = Math.sign(after.lateral);
      const t = after.tangent;
      this.x -= t.z * sign * over;
      this.z += t.x * sign * over;
      this.vLong *= 1 - Math.min(0.32, over * 0.38);
      this.vLat *= -0.25;
      this.wallHit = Math.min(1, over);
    } else {
      this.wallHit = 0;
    }

    this.syncObject(dt);
  }

  syncObject(dt = 0) {
    const o = this.object;
    o.position.set(this.x, 0.17, this.z);
    o.rotation.y = this.heading;

    // Body roll into the corner and pitch under power.
    const roll = THREE.MathUtils.clamp(-this.vLat * 0.035, -0.16, 0.16);
    const pitch = THREE.MathUtils.clamp(this.throttle * 0.022 - (this.throttle < 0 ? 0.03 : 0), -0.05, 0.05);
    this.body.rotation.z += (roll - this.body.rotation.z) * Math.min(1, dt * 9 || 1);
    this.body.rotation.x += (pitch - this.body.rotation.x) * Math.min(1, dt * 9 || 1);

    if (dt > 0) {
      const spin = (this.vLong / 0.3) * dt; // wheel radius 0.3
      const steerAngle = -this.steer * 0.42;
      for (const key of ['fl', 'fr', 'bl', 'br']) {
        const w = this.wheels[key];
        if (!w) continue;
        w.userData.spin = (w.userData.spin + spin) % (Math.PI * 2);
        w.rotation.set(w.userData.spin, key[0] === 'f' ? steerAngle : 0, 0, 'YXZ');
      }
    }
  }
}

/** Closest points between two 2D segments, as parameters along each. */
function segmentClosest(p0, p1, q0, q1) {
  const ux = p1.x - p0.x, uz = p1.z - p0.z;
  const vx = q1.x - q0.x, vz = q1.z - q0.z;
  const wx = p0.x - q0.x, wz = p0.z - q0.z;
  const a = ux * ux + uz * uz;
  const b = ux * vx + uz * vz;
  const c = vx * vx + vz * vz;
  const d = ux * wx + uz * wz;
  const e = vx * wx + vz * wz;
  const den = a * c - b * b;

  const clamp = (v) => Math.max(0, Math.min(1, v));
  let s = den > 1e-8 ? clamp((b * e - c * d) / den) : 0;
  const t = c > 1e-8 ? clamp((e + s * b) / c) : 0;
  s = a > 1e-8 ? clamp((t * b - d) / a) : 0;

  return {
    ax: p0.x + ux * s, az: p0.z + uz * s,
    bx: q0.x + vx * t, bz: q0.z + vz * t,
  };
}

function hull(car) {
  const f = car.forward;
  return [
    { x: car.x + f.x * car.hullAxle, z: car.z + f.z * car.hullAxle },
    { x: car.x - f.x * car.hullAxle, z: car.z - f.z * car.hullAxle },
  ];
}

/**
 * Resolve car-vs-car overlap between the two capsules. Both the separation
 * and the speed each car loses are split by mass, so a heavy van really does
 * barge a kart aside.
 */
export function resolveCollisions(cars, onImpact) {
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      const [a0, a1] = hull(a), [b0, b1] = hull(b);
      const cp = segmentClosest(a0, a1, b0, b1);
      const dx = cp.bx - cp.ax, dz = cp.bz - cp.az;
      const dist = Math.hypot(dx, dz);
      const min = a.hullRadius + b.hullRadius;
      if (dist >= min) continue;

      const total = a.mass + b.mass;
      const aShare = b.mass / total;   // the lighter car gives way
      const bShare = a.mass / total;
      let nx, nz;
      if (dist < 1e-4) {
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        nx = (b.x - a.x) / len; nz = (b.z - a.z) / len;
      } else {
        nx = dx / dist; nz = dz / dist;
      }
      const push = min - dist;
      a.x -= nx * push * aShare; a.z -= nz * push * aShare;
      b.x += nx * push * bShare; b.z += nz * push * bShare;

      // Full world velocity (+vLat is along the car's left axis: f.z, -f.x),
      // so side-swipes register as closing speed too.
      const av = a.forward.x * a.vLong + a.forward.z * a.vLat;
      const avz = a.forward.z * a.vLong - a.forward.x * a.vLat;
      const bv = b.forward.x * b.vLong + b.forward.z * b.vLat;
      const bvz = b.forward.z * b.vLong - b.forward.x * b.vLat;
      const rel = (bv - av) * nx + (bvz - avz) * nz;
      if (rel < 0) {
        const imp = Math.min(1, -rel / 18);
        // Exchange momentum along each car's own axis instead of braking
        // both: the rammer slows, the rammed car is shoved forward, a
        // T-bone shoves sideways only, and door-to-door rubbing costs
        // nothing. The player's own losses are further softened — being
        // mobbed by the pack must not bleed the race away.
        const j = Math.min(-rel, 14) * 0.6;
        const aFwd = nx * a.forward.x + nz * a.forward.z;
        const bFwd = nx * b.forward.x + nz * b.forward.z;
        const dA = -j * aShare * aFwd;
        const dB = j * bShare * bFwd;
        a.vLong += dA * (a.isPlayer && dA < 0 ? 0.7 : 1);
        b.vLong += dB * (b.isPlayer && dB < 0 ? 0.7 : 1);
        // Kick along the contact normal, projected onto each car's own
        // lateral axis — a fixed-sign kick pulls a T-boned car into its
        // attacker and jolts rear-end shunts sideways.
        const aLat = nx * a.forward.z - nz * a.forward.x;
        const bLat = nx * b.forward.z - nz * b.forward.x;
        a.vLat += rel * 0.16 * aShare * aLat;
        b.vLat -= rel * 0.16 * bShare * bLat;
        if (onImpact && imp > 0.18) onImpact(a, b, imp);
      }
    }
  }
}
