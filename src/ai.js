// AI drivers: follow a personal racing line, brake for curvature, use items.
import { mulberry32 } from './track.js';

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
    let worst = 0;
    const scan = Math.round((7 + speed * 0.85) / line.spacing);
    for (let k = 2; k < scan; k++) worst = Math.max(worst, line.curveAt(idx + k));
    // Fastest speed at which the car can still generate the yaw rate the
    // corner asks for: omega = v * curvature must stay inside its handling.
    const cornerSpeed = Math.min(car.topSpeed, (car.handling * 0.8) / Math.max(0.006, worst));
    const target = cornerSpeed * (0.82 + 0.2 * this.skill) * (car.surface === 'road' ? 1 : 0.75);

    let throttle = speed < target ? 1 : (speed > target * 1.12 ? -1 : 0.25);
    if (race && race.phase === 'countdown') throttle = 0;
    // A lapse eases off the gas but not the brake — now that braking is
    // analog, scaling a negative throttle would soften corner entries.
    if (this.mistake > 0.5 && throttle > 0) throttle *= 0.75;

    car.applyInput(throttle, Math.max(-1, Math.min(1, steer)), dt);

    // Items.
    if (car.item) {
      this.itemDelay -= dt;
      if (this.itemDelay <= 0) {
        this.itemDelay = 0.8 + this.rng() * 2.2;
        const useIt = car.item === 'boost'
          ? worst < 0.02 || this.rng() < 0.3
          : this.rng() < 0.55 + this.aggression * 0.3;
        if (useIt && race) race.useItem(car);
      }
    }
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
