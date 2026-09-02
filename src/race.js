// Race director: grid, countdown, laps, standings, items and effects.
import * as THREE from 'three';
import { Car, resolveCollisions } from './car.js';
import { AIDriver } from './ai.js';
import { ItemField, Projectile, Hazard, ITEMS } from './items.js';
import { Particles, SkidMarks, DUST } from './fx.js';
import { mulberry32 } from './track.js';
import { EngineSound, sfx } from './audio.js';

const GRID = 6;
const DRAFT_RANGE = 15;

export class Race {
  constructor({ engine, track, playerSpec, roster, difficulty = 1 }) {
    this.engine = engine;
    this.track = track;
    this.difficulty = difficulty;
    this.rng = mulberry32((track.def.seed || 1) * 7919 + 13);

    this.particles = new Particles(engine.world);
    this.skids = new SkidMarks(engine.world);
    this.camLead = 0;   // how far down the road the camera is looking, eased
    this.items = new ItemField(track, engine.world, this.rng);
    this.projectiles = [];

    this.cars = [];
    this.drivers = [];
    this.messages = [];

    const slots = track.startSlots(GRID);
    const field = this.buildField(playerSpec, roster);
    // Player starts at the back — there is nothing to overtake from pole.
    field.forEach((spec, i) => {
      const isPlayer = spec.__player;
      const car = new Car(spec, track, { isPlayer, name: spec.name });
      car.placeAt(slots[i]);
      car.lap = 1;
      car.crossCount = Math.floor((car.totalProgress - track.startIndex) / track.line.n);
      car.maxCross = car.crossCount;
      car.crossedLine = false;
      engine.world.add(car.object);
      this.cars.push(car);
      if (isPlayer) {
        this.player = car;
        car.runoffEase = [1, 0.5, 0, 0][difficulty] ?? 0;
      } else {
        const skill = Math.min(0.98, 0.48 + difficulty * 0.115 + this.rng() * 0.09);
        this.drivers.push(new AIDriver(car, track, {
          skill,
          aggression: 0.35 + this.rng() * 0.5,
          seed: Math.floor(this.rng() * 1e6),
        }));
      }
    });

    this.marker = this.buildMarker();
    engine.world.add(this.marker);

    this.phase = 'countdown';
    this.clock = -3.6;
    this.raceTime = 0;
    this.finishOrder = [];
    this.engineSound = new EngineSound();
    this.lastBeep = 99;
    this.finalLapAnnounced = false;
    this.celebrate = 0;
    this.autopilot = null;
    this.onRumble = null;
  }

  /** Haptics for whatever just happened to the player's car. */
  buzz(strong, weak, ms) {
    if (this.onRumble && !this.autopilot) this.onRumble(strong, weak, ms);
  }

  /** One-shot sfx are for a human at the wheel; the attract demo runs silent. */
  playSfx(fn) {
    if (!this.autopilot) fn();
  }

  /** Hand the player's car to the AI — used for the attract loop and tests. */
  setAutopilot(on, skill = 0.92) {
    if (!on) { this.autopilot = null; return; }
    this.autopilot = new AIDriver(this.player, this.track, { skill, aggression: 0.6, seed: 7 });
  }

  buildField(playerSpec, roster) {
    const pool = roster.filter((r) => r.id !== playerSpec.id);
    const picked = [];
    const rng = this.rng;
    while (picked.length < GRID - 1 && pool.length) {
      picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    }
    const player = { ...playerSpec, __player: true };
    // Grid order: rivals first, player last.
    return [...picked, player];
  }

  buildMarker() {
    const group = new THREE.Group();
    const geo = new THREE.ConeGeometry(0.62, 1.2, 4);
    geo.rotateX(Math.PI);
    const arrow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffe14d }));
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 1.85, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    ring.position.y = -2.9;
    group.add(arrow, ring);
    group.renderOrder = 5;
    return group;
  }

  start() {
    this.engineSound.start();
  }

  dispose() {
    this.engineSound.stop();
  }

  message(text, kind = 'info', ttl = 2.2) {
    this.messages.push({ text, kind, ttl });
  }

  useItem(car) {
    if (!car.item || car.spin > 0) return;
    const kind = car.item;
    car.item = null;
    if (kind === 'boost') {
      car.giveBoost(2.1);
      if (car === this.player) { this.playSfx(sfx.boost); this.buzz(0.3, 0.6, 380); }
      this.particles.burst(car.x, 0.35, car.z, 14, {
        colour: [0.4, 1, 0.6], size: 0.5, life: 0.5, spread: 5, glow: true, opacity: 0.9,
      });
    } else if (kind === 'missile') {
      this.projectiles.push(new Projectile(car, this.engine.world));
      if (car === this.player) this.playSfx(sfx.missile);
    } else if (kind === 'mine') {
      this.projectiles.push(new Hazard(car, this.engine.world));
      if (car === this.player) this.playSfx(sfx.select);
    }
  }

  update(dt, input) {
    if (this.phase === 'countdown') {
      this.clock += dt;
      const remaining = Math.ceil(-this.clock);
      if (remaining !== this.lastBeep && remaining >= 1 && remaining <= 3) {
        this.lastBeep = remaining;
        sfx.countdown();
        this.buzz(0.12, 0.25, 90);
      }
      if (this.clock >= 0) {
        this.phase = 'racing';
        this.clock = 0;
        sfx.go();
        this.buzz(0.5, 0.5, 260);
        this.message('GO!', 'go', 1.2);
        for (const c of this.cars) c.lapStart = 0;
      }
    } else if (this.phase === 'racing') {
      this.raceTime += dt;
    } else if (this.phase === 'finished') {
      this.raceTime += dt;
      this.postTime = (this.postTime || 0) + dt;
      this.emitCelebration(dt);
    }

    const racing = this.phase !== 'countdown';

    // --- Player input -----------------------------------------------------
    const p = this.player;
    if (p && this.autopilot) {
      this.autopilot.update(dt, this.cars, this);
    } else if (p && !p.finished) {
      const throttle = racing ? input.throttle : 0;
      p.applyInput(throttle, this.assistSteer(p, input.steer), dt, !!input.handbrake);
      if (input.item && !this.itemHeld) this.useItem(p);
      this.itemHeld = input.item;
    } else if (p && p.finished) {
      // Coast to a stop after the flag.
      p.applyInput(0, p.steer * 0.5, dt);
    }

    this.updateSlipstream();
    for (const d of this.drivers) d.update(dt, this.cars, this);

    for (const car of this.cars) {
      const before = car.lap;
      car.update(dt);
      this.trackLap(car);
      if (car.lap !== before && car === this.player) this.playSfx(sfx.lap);
      this.emitEffects(car, dt);
    }

    resolveCollisions(this.cars, (a, b, imp) => {
      if (a === this.player || b === this.player) {
        this.playSfx(() => sfx.bump(imp));
        this.engine.shake(imp * 0.8);
        this.buzz(imp * 0.7, imp * 0.4, 110);
      }
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      this.particles.burst(mx, 0.5, mz, 5, {
        colour: [1, 0.85, 0.4], size: 0.28, life: 0.35, spread: 4, glow: true, opacity: 1,
      });
    });

    for (const car of this.cars) {
      if (car.wallHit > 0.02 && car === this.player) {
        this.playSfx(sfx.wall);
        this.engine.shake(car.wallHit * 0.9);
        this.buzz(car.wallHit * 0.8, car.wallHit * 0.5, 130);
        this.particles.burst(car.x, 0.5, car.z, 4, {
          colour: [1, 0.9, 0.5], size: 0.22, life: 0.3, spread: 3, glow: true, opacity: 1,
        });
      }
    }

    this.items.update(dt, this.cars, (car, kind) => {
      if (car === this.player) {
        this.playSfx(sfx.pickup);
        this.message(ITEMS[kind].label, 'item', 1.4);
      }
    });

    for (const proj of this.projectiles) {
      proj.update(dt, this.cars, this.track);
      if (proj.dead) {
        if (proj.hitCar) {
          this.playSfx(sfx.explode);
          this.particles.burst(proj.hitCar.x, 0.6, proj.hitCar.z, 22, {
            colour: [1, 0.6, 0.2], size: 0.55, life: 0.7, spread: 8, up: 6, glow: true, opacity: 1,
          });
          if (proj.hitCar === this.player) { this.engine.shake(1.8); this.buzz(1, 0.8, 420); }
          if (proj.owner === this.player) this.message('DIRECT HIT', 'good', 1.6);
          if (proj.hitCar === this.player) this.message('SPUN OUT!', 'bad', 1.6);
        }
        proj.dispose(this.engine.world);
      }
    }
    this.projectiles = this.projectiles.filter((p2) => !p2.dead);

    this.updateStandings();
    this.particles.update(dt);
    this.skids.update(dt);
    this.engine.decayShake(dt);

    // Player marker.
    if (p) {
      this.marker.position.set(p.x, 3.1 + Math.sin(this.raceTime * 4) * 0.16, p.z);
      this.marker.rotation.y = this.raceTime * 1.6;
      this.marker.visible = true;
    }

    // Camera and engine note.
    if (p) {
      // Look a little down the road, further the faster we go — but never so
      // far that the car ends up at the edge whichever way the road runs
      // across the screen (an upright phone is narrow), and eased, so a turbo
      // does not lurch the camera ahead and leave the car behind.
      const e = this.engine;
      const reach = Math.min(e.viewSize, e.viewSize * e.aspect) * 0.22;
      const wantLead = Math.max(-reach, Math.min(reach, p.vLong * 0.42));
      this.camLead += (wantLead - this.camLead) * Math.min(1, dt * 3);
      const f = p.forward;
      e.look(p.x + f.x * this.camLead, 0, p.z + f.z * this.camLead);
      // Pull in close for the finish celebration, back out while racing —
      // and keep backing out under a turbo instead of capping at top speed.
      const targetZoom = this.phase === 'finished' && !this.autopilot
        ? 27
        : 35 + Math.min(14, Math.abs(p.vLong) * 0.42);
      this.engine.setZoom(this.engine.viewSize + (targetZoom - this.engine.viewSize) * Math.min(1, dt * 2));
      this.particles.setScale(this.engine.renderer.domElement.height, this.engine.viewSize);
      this.engineSound.update(
        Math.min(1, Math.abs(p.vLong) / p.topSpeed),
        Math.max(0, p.throttle),
        p.slip,
        p.boost > 0,
      );
    }

    this.messages = this.messages.filter((m) => (m.ttl -= dt) > 0);
  }

  /** Confetti over the line — a podium finish showers the coasting car. */
  emitCelebration(dt) {
    if (!this.celebrate || this.postTime > 3.4) return;
    const p = this.player;
    const GOLD = [1, 0.84, 0.25];
    const PARTY = [GOLD, [0.35, 0.8, 1], [1, 0.45, 0.6], [0.55, 1, 0.6], [0.8, 0.6, 1]];
    // The flag moment itself pops: two shockwave bursts around the car.
    if (!this.confettiStarted) {
      this.confettiStarted = true;
      for (const side of [-1, 1]) {
        this.particles.burst(p.x + side * 2.5, 1.0, p.z, this.celebrate === 2 ? 22 : 14, {
          colour: GOLD, size: 0.55, life: 1.0, spread: 7, up: 8, glow: true, opacity: 1,
        });
      }
    }
    this.confettiClock = (this.confettiClock ?? 0) - dt;
    if (this.confettiClock > 0) return;
    this.confettiClock = this.celebrate === 2 ? 0.05 : 0.09;
    const n = this.celebrate === 2 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const colour = this.celebrate === 2 ? PARTY[Math.floor(Math.random() * PARTY.length)] : GOLD;
      this.particles.emit(
        p.x + (Math.random() - 0.5) * 9,
        3.6 + Math.random() * 2.8,
        p.z + (Math.random() - 0.5) * 9,
        {
          velocity: [(Math.random() - 0.5) * 3, -0.6, (Math.random() - 0.5) * 3],
          colour, size: 0.5, life: 1.9, grow: 0.22, rise: -2.6, drag: 0.6,
          glow: true, opacity: 1,
        },
      );
    }
  }

  /** Sitting in the tow of the car ahead is worth a little extra speed. */
  /** Training wheels that come off as the difficulty climbs. Out near the
   *  edge of the road the player's steering is blended toward the line a
   *  clean driver would take, so a late or shaky input is nudged back onto
   *  the tarmac before a wheel drops. In the middle of the road it does
   *  nothing, and at Legend it is gone. A first-timer on touch spent a third
   *  of every race on the grass without it. */
  assistSteer(p, steer) {
    const strength = [0.7, 0.45, 0.2, 0][this.difficulty] ?? 0;
    if (!strength || p.lateral == null) return steer;
    const edge = Math.min(1, Math.max(0, (Math.abs(p.lateral) / this.track.roadHalf - 0.55) / 0.45));
    if (edge <= 0) return steer;
    const line = this.track.line;
    const look = 5.5 + Math.max(0, p.vLong) * 0.42;
    const aim = line.point(Math.round(p.lineIndex + look / line.spacing));
    let want = Math.atan2(aim.x - p.x, aim.z - p.z) - p.heading;
    while (want > Math.PI) want -= Math.PI * 2;
    while (want < -Math.PI) want += Math.PI * 2;
    const ideal = Math.max(-1, Math.min(1, -want * 2.1));
    const k = strength * edge;
    return steer * (1 - k) + ideal * k;
  }

  updateSlipstream() {
    for (const car of this.cars) {
      const f = car.forward;
      let best = 0;
      for (const other of this.cars) {
        if (other === car) continue;
        const dx = other.x - car.x, dz = other.z - car.z;
        const ahead = dx * f.x + dz * f.z;
        if (ahead < 1.8 || ahead > DRAFT_RANGE) continue;
        if (Math.abs(dx * f.z - dz * f.x) > 2.4) continue;
        best = Math.max(best, 1 - ahead / DRAFT_RANGE);
      }
      car.draft = best;
    }
  }

  emitEffects(car, dt) {
    if (this.quiet) return;
    const speed = Math.abs(car.vLong);
    const f = car.forward;
    const rx = f.z, rz = -f.x;

    if (car.slip > 0.22 && speed > 4) {
      car.skidAccum = (car.skidAccum || 0) + dt;
      if (car.skidAccum > 0.022) {
        car.skidAccum = 0;
        for (const side of [-1, 1]) {
          this.skids.add(car.x + rx * side * 0.62 - f.x * 0.85, car.z + rz * side * 0.62 - f.z * 0.85, car.heading, 1);
        }
      }
      if (Math.random() < car.slip * 0.7) {
        const c = DUST[car.surface];
        this.particles.emit(car.x - f.x * 1.2, 0.24, car.z - f.z * 1.2, {
          velocity: [(Math.random() - 0.5) * 3, 0.8 + Math.random(), (Math.random() - 0.5) * 3],
          colour: c, size: 0.42, life: 0.72, grow: 2.4, opacity: 0.5,
        });
      }
    }

    if (car.surface !== 'road' && speed > 3 && Math.random() < 0.6) {
      this.particles.emit(car.x - f.x * 1.1, 0.2, car.z - f.z * 1.1, {
        velocity: [(Math.random() - 0.5) * 4, 1.6 + Math.random() * 2, (Math.random() - 0.5) * 4],
        colour: DUST[car.surface], size: 0.4, life: 0.6, grow: 2.6, opacity: 0.6,
      });
    }

    if (car.boost > 0) {
      this.particles.emit(car.x - f.x * 1.4, 0.36, car.z - f.z * 1.4, {
        velocity: [-f.x * 6 + (Math.random() - 0.5) * 2, 0.6, -f.z * 6 + (Math.random() - 0.5) * 2],
        colour: [0.45, 1, 0.75], size: 0.34, life: 0.32, grow: 1.4, glow: true, opacity: 1,
      });
    }

    if (car.spin > 0 && Math.random() < 0.8) {
      this.particles.emit(car.x, 0.5, car.z, {
        velocity: [(Math.random() - 0.5) * 5, 1.6, (Math.random() - 0.5) * 5],
        colour: [0.3, 0.3, 0.33], size: 0.5, life: 0.6, grow: 2.2, opacity: 0.55,
      });
    }
  }

  /**
   * Lap counting by start/finish crossings. `totalProgress` grows without
   * bound, so the number of crossings is just how many centre-line lengths
   * past the line the car is; a lap is booked whenever that count goes up.
   * The very first crossing is the race start itself, so it only starts the
   * clock.
   */
  trackLap(car) {
    if (car.finished) return;
    const n = this.track.line.n;
    const cross = Math.floor((car.totalProgress - this.track.startIndex) / n);
    if (cross === car.crossCount) return;
    if (cross < car.crossCount) { car.crossCount = cross; return; }
    car.crossCount = cross;
    // A car pushed back over the line re-crosses it on the way forward again;
    // only a new high-water mark is a fresh crossing, so shuttling across the
    // line can't farm laps.
    if (cross <= car.maxCross) return;
    car.maxCross = cross;
    if (this.phase === 'countdown') return;

    if (!car.crossedLine) {
      car.crossedLine = true;
      car.lapStart = this.raceTime;
      return;
    }

    car.lapTimes.push(this.raceTime - car.lapStart);
    car.lapStart = this.raceTime;
    car.lap += 1;

    if (car.lap > this.track.laps) {
      car.finished = true;
      car.finishTime = this.raceTime;
      this.finishOrder.push(car);
      if (car === this.player) {
        this.phase = 'finished';
        this.postTime = 0;
        this.playSfx(sfx.finish);
        if (!this.autopilot) {
          const place = this.finishOrder.length;
          const label = place === 1 ? 'WINNER!'
            : place === 2 ? '2ND PLACE!'
            : place === 3 ? '3RD PLACE!'
            : `FINISHED ${place}TH`;
          this.message(label, place <= 3 ? 'finish' : 'go', 3.4);
          this.buzz(0.9, 0.6, place === 1 ? 650 : 380);
          this.celebrate = place === 1 ? 2 : place <= 3 ? 1 : 0;
        }
      }
    } else if (car === this.player && car.lap === this.track.laps && !this.finalLapAnnounced) {
      this.finalLapAnnounced = true;
      this.message('FINAL LAP', 'go', 2.0);
    }
  }

  updateStandings() {
    const ranked = [...this.cars].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.totalProgress - a.totalProgress;
    });
    ranked.forEach((c, i) => { c.racePosition = i + 1; });
    this.standings = ranked;
  }

  /**
   * After the player takes the flag, run the rest of the field to the line
   * headlessly so the classification has real times instead of "unfinished".
   * Effects and pickups are skipped; only driving and lap counting matter.
   */
  settle(maxSeconds = 240) {
    this.quiet = true;
    const step = 1 / 30;
    let t = 0;
    while (t < maxSeconds && this.cars.some((c) => !c.finished)) {
      for (const d of this.drivers) d.update(step, this.cars, this);
      if (this.autopilot && !this.player.finished) this.autopilot.update(step, this.cars, this);
      for (const car of this.cars) {
        if (car.finished) continue;
        car.update(step);
        this.trackLap(car);
      }
      resolveCollisions(this.cars);
      this.raceTime += step;
      t += step;
    }
    this.quiet = false;
    this.updateStandings();
  }

  /** Everyone has crossed the line, or the player finished and time ran out. */
  get isOver() {
    return this.phase === 'finished' && (this.postTime ?? 0) > 4.5;
  }

  results() {
    const rest = this.standings.filter((c) => !this.finishOrder.includes(c));
    const order = [...this.finishOrder, ...rest];
    return order.map((car, i) => ({
      place: i + 1,
      name: car.name,
      isPlayer: car === this.player,
      time: car.finished ? car.finishTime : null,
      lap: Math.min(car.lap, this.track.laps),
      laps: this.track.laps,
      best: car.lapTimes.length ? Math.min(...car.lapTimes) : null,
      colour: car.spec.colour,
    }));
  }
}
