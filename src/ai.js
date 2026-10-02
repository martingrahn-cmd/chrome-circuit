// AI drivers: follow a personal racing line, brake for curvature, use items.
import { mulberry32 } from './track.js';

// How far a corner must turn before a rival will slide it, in radians.
const DRIFT_TURN = 1.1;

export class AIDriver {
  constructor(car, track, opts = {}) {
    this.car = car;
    this.track = track;
    this.skill = opts.skill ?? 0.8;        // 0..1
    this.aggression = opts.aggression ?? 0.5;
    this.rng = mulberry32(opts.seed ?? 1);
    this.lineOffset = (this.rng() - 0.5) * track.roadHalf * 0.6;
    this.offsetTimer = 0;
    this.mistake = 0;
    this.mistakeTimer = 2 + this.rng() * 6;
    this.itemDelay = 0.6 + this.rng() * 1.6;
    // Humans need a beat to react to the lights; so should the field.
    this.launchDelay = 0.15 + (1 - this.skill) * (0.4 + this.rng() * 0.5);
    // Whether this driver slides the tight bends for the kick out of them.
    // Sharper drivers do it more; `drift` overrides for tests.
    this.drifts = opts.drift ?? this.rng() < 0.25 + 0.7 * this.skill;
    this.drifting = false;
    // Each sample's corner, if it is in one worth sliding.
    const n = track.line.n;
    this.bendAt = new Array(n).fill(null);
    for (const run of track.corners()) {
      if (run.turn < DRIFT_TURN) continue;
      for (let k = 0; k < run.len; k++) this.bendAt[(run.start + k) % n] = { ...run, k };
    }
  }

  update(dt, cars, race) {
    const car = this.car;
    const line = this.track.line;

    // Wander the preferred line a little so the pack does not drive in a column.
    this.offsetTimer -= dt;
    if (this.offsetTimer <= 0) {
      this.offsetTimer = 1.4 + this.rng() * 2.4;
      this.targetOffset = (this.rng() - 0.5) * this.track.roadHalf * 0.7;
    }
    this.lineOffset += ((this.targetOffset ?? 0) - this.lineOffset) * Math.min(1, dt * 1.5);

    // Occasional lapse of concentration keeps lower difficulties beatable.
    this.mistakeTimer -= dt;
    if (this.mistakeTimer <= 0) {
      this.mistakeTimer = 5 + this.rng() * 9;
      this.mistake = (1 - this.skill) * (0.5 + this.rng()) * 1.1;
    }
    this.mistake = Math.max(0, this.mistake - dt * 0.7);

    const speed = Math.max(0, car.vLong);
    const lookDist = 5.5 + speed * 0.42;
    const idx = car.lineIndex;
    const aim = line.point(Math.round(idx + lookDist / line.spacing));
    const aimT = line.tangent(Math.round(idx + lookDist / line.spacing));

    let tx = aim.x + aimT.z * this.lineOffset;
    let tz = aim.z - aimT.x * this.lineOffset;

    // Nudge around a car directly ahead.
    const blocker = this.carAhead(cars);
    if (blocker) {
      const side = this.sideOf(blocker) >= 0 ? -1 : 1;
      const dodge = this.track.roadHalf * 0.85 * side * this.aggression;
      tx += aimT.z * dodge;
      tz -= aimT.x * dodge;
    }

    // Steer round an oil drum on the line ahead — the whole field used to
    // drive into them blind. A sharper driver sees it sooner.
    const drum = race && this.hazardAhead(race.projectiles, 6 + speed * (0.4 + 0.5 * this.skill));
    if (drum) {
      const side = this.sideOf(drum) >= 0 ? -1 : 1;
      const dodge = this.track.roadHalf * 0.7 * side;
      tx += aimT.z * dodge;
      tz -= aimT.x * dodge;
    }

    // Steer toward the aim point.
    let want = Math.atan2(tx - car.x, tz - car.z) - car.heading;
    while (want > Math.PI) want -= Math.PI * 2;
    while (want < -Math.PI) want += Math.PI * 2;
    // Positive steer turns right, which lowers the heading, hence the sign.
    let steer = Math.max(-1, Math.min(1, -want * 2.1));
    steer += this.mistake * (this.rng() - 0.5);

    // Someone is up the inside: hold your line away from them rather than
    // squeezing them off. Racing you cannot overtake in is not racing.
    const neighbour = this.alongside(cars);
    if (neighbour) steer += Math.sign(this.sideOf(neighbour)) * 0.28;

    // Brake for the corner that is coming, not the one under the wheels.
    let worst = 0, iceAhead = car.surface === 'ice';
    const scan = Math.round((7 + speed * 0.85) / line.spacing);
    for (let k = 2; k < scan; k++) {
      worst = Math.max(worst, line.curveAt(idx + k));
      if (line.iceAt(idx + k)) iceAhead = true;
    }
    // Fastest speed at which the car can still generate the yaw rate the
    // corner asks for: omega = v * curvature must stay inside its handling.
    const cornerSpeed = Math.min(car.topSpeed, (car.handling * 0.8) / Math.max(0.006, worst));
    const grip = car.surface === 'road' || car.surface === 'ice' ? 1 : 0.75;
    // A bend on ice is taken gently, or not at all.
    const ice = iceAhead && worst > 0.015 ? 0.8 : 1;
    const honest = cornerSpeed * (0.82 + 0.2 * this.skill) * grip * ice;
    let target = honest;
    // Pace by difficulty. Skill alone only moved Rookie 5% off Pro, and a
    // first-timer following the road by eye laps 25% slower than that —
    // Rookie has to be a race such a driver can win.
    if (race) target *= [0.78, 0.94, 0.985, 1][race.difficulty] ?? 1;

    // Rubber-band, both ways, fading with difficulty and cancelling out for
    // the attract autopilot, which races against itself. A rival well ahead
    // of the player eases off, so a scrappy first lap can be driven back
    // into. And once the player *leads*, the pack behind picks up its pace
    // the further it drops back — never past the honest speed it would run
    // at Legend — so a good driver on Rookie wins by a car length, not by
    // three-quarters of a lap. A player who is not leading feels none of it.
    if (race && race.player && race.player !== car && !race.player.finished) {
      const gapAhead = (car.totalProgress - race.player.totalProgress) * line.spacing;
      if (gapAhead > 0) {
        const band = [0.2, 0.06, 0.03, 0.02][race.difficulty] ?? 0.08;
        target *= 1 - Math.min(1, gapAhead / 70) * band;
      } else if (race.player.racePosition === 1) {
        const chase = [0.2, 0.1, 0.04, 0][race.difficulty] ?? 0;
        target = Math.min(honest, target * (1 + Math.min(1, -gapAhead / 60) * chase));
      }
    }

    let throttle = speed < target ? 1 : (speed > target * 1.12 ? -1 : 0.25);
    if (race && race.phase === 'countdown') throttle = 0;
    else if (this.launchDelay > 0 && race && race.raceTime < 3) {
      this.launchDelay -= dt;
      throttle = 0;
    }
    // A lapse eases off the gas but not the brake — now that braking is
    // analog, scaling a negative throttle would soften corner entries.
    if (this.mistake > 0.5 && throttle > 0) throttle *= 0.75;

    // Drift the tight bends: handbrake on as one arrives with the wheel
    // already turned, off again at the exit, where the kick pays out.
    if (this.drifts) {
      const n = line.n;
      const bend = this.bendAt[(idx + Math.round(2 / line.spacing)) % n];
      const here = this.bendAt[idx % n];
      // Steering into it: a left-hand bend (inside +1) wants negative steer.
      const into = bend && Math.sign(steer) === -bend.inside && Math.abs(steer) > 0.35;
      const outside = car.drift && car.lateral * car.drift < -this.track.roadHalf * 0.7;
      if (!this.drifting && speed > 11 && into && bend.k < bend.len * 0.5) this.drifting = true;
      else if (this.drifting && (!here || here.k > here.len - 3 || outside || speed < 7)) this.drifting = false;
    } else {
      this.drifting = false;
    }

    car.applyInput(throttle, Math.max(-1, Math.min(1, steer)), dt, this.drifting);

    // Items. Hold them until they are worth something: a turbo waits for a
    // straight, a rocket for a car ahead to lock onto, a drum for a car close
    // behind to catch. Firing everything on sight littered the track — on
    // Neon Speedway one item every 2.5 s and thirty-odd spin-outs a race, so
    // who won was a lottery. Holding an item also keeps a car from picking up
    // the next one, which thins the supply without touching the boxes.
    if (car.item && !this.holding) this.itemDelay = 1.5 + this.rng() * 2;
    this.holding = !!car.item;
    if (car.item) {
      this.itemDelay -= dt;
      if (this.itemDelay <= 0) {
        this.itemDelay = 1.2 + this.rng() * 2.4;
        let useIt;
        if (car.item === 'boost') useIt = worst < 0.02;
        else if (car.item === 'missile') useIt = !!this.nearby(cars, 4, 34) && this.rng() < 0.45 + this.aggression * 0.3;
        else useIt = !!this.nearby(cars, -16, -2) && this.rng() < 0.5 + this.aggression * 0.3;
        if (useIt && race) race.useItem(car);
      }
    }
  }

  /** The nearest live oil drum in this car's path, within `range` ahead. */
  hazardAhead(projectiles, range) {
    const f = this.car.forward;
    let best = null, bestD = range;
    for (const h of projectiles || []) {
      if (h.dead || h.arm === undefined) continue;
      const dx = h.x - this.car.x, dz = h.z - this.car.z;
      const along = dx * f.x + dz * f.z;
      if (along <= 0 || along > bestD) continue;
      if (Math.abs(dx * f.z - dz * f.x) > 2.8) continue;
      best = h; bestD = along;
    }
    return best;
  }

  /** A car roughly in line with this one, between `from` and `to` units
   *  along its heading (negative = behind). */
  nearby(cars, from, to) {
    const f = this.car.forward;
    for (const o of cars) {
      if (o === this.car || o.finished) continue;
      const dx = o.x - this.car.x, dz = o.z - this.car.z;
      const along = dx * f.x + dz * f.z;
      if (along < from || along > to) continue;
      if (Math.abs(dx * f.z - dz * f.x) < 4) return o;
    }
    return null;
  }

  /** Positive when the other car is on our left (local +X). */
  sideOf(other) {
    const f = this.car.forward;
    return (other.x - this.car.x) * f.z - (other.z - this.car.z) * f.x;
  }

  /** The nearest car level with this one, if any. */
  alongside(cars) {
    const f = this.car.forward;
    let best = null, bestSide = Infinity;
    for (const o of cars) {
      if (o === this.car) continue;
      const dx = o.x - this.car.x, dz = o.z - this.car.z;
      const ahead = dx * f.x + dz * f.z;
      if (Math.abs(ahead) > 2.6) continue;
      const side = Math.abs(dx * f.z - dz * f.x);
      if (side > 3.2 || side >= bestSide) continue;
      best = o; bestSide = side;
    }
    return best;
  }

  carAhead(cars) {
    const f = this.car.forward;
    let best = null, bestD = 9;
    for (const o of cars) {
      if (o === this.car) continue;
      const dx = o.x - this.car.x, dz = o.z - this.car.z;
      const ahead = dx * f.x + dz * f.z;
      if (ahead <= 0.5 || ahead > bestD) continue;
      const side = Math.abs(dx * f.z - dz * f.x);
      if (side > 2.6) continue;
      best = o; bestD = ahead;
    }
    return best;
  }
}
