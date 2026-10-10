// Race director: grid, countdown, laps, standings, items and effects.
import * as THREE from 'three';
import { Car, resolveCollisions, carGap, DRIFT } from './car.js';
import { AIDriver } from './ai.js';
import { ItemField, Projectile, Hazard, ITEMS } from './items.js';
import { fillDistance } from './ghostlink.js';
import { Particles, SkidMarks, Snowfall, DUST } from './fx.js';
import { mulberry32 } from './track.js';
import { EngineSound, sfx } from './audio.js';
import { instance } from './assets.js';

const GRID = 6;

// Airtime long enough to count as a jump pays out a kick, like a drift does.
const BIG_AIR = 0.6;
// A close call: passing within this much of another car without touching it,
// at least this much faster, pays a short kick. Each rival once per few seconds.
const CLOSE = { gap: 0.45, speed: 4, every: 6, kick: 0.35 };

// Rocket start: the gas going down in this window round the green light
// (seconds, green at 0) launches with a turbo; going down before it, and
// still held at green, spins the wheels instead.
const LAUNCH = { from: -0.3, to: 0.15, boost: 1.0, stall: 0.6 };
// The first races of a visit say how the start works; after that, they don't.
let launchHints = 2;
const DRAFT_RANGE = 15;

// How much world the camera shows, relative to the original framing: 0.85 is
// 15% closer, so the cars and the trackside read bigger while the next corner
// is still in view at full speed. Everything that follows the camera — the
// look-ahead, the particle size, the celebration pull-in — scales with it.
const CAMERA_ZOOM = 0.85;

// Time trial ghosts: samples a second, and the stride of one stored sample
// [t, x, y, z, heading, d] — seconds into the lap, position, facing, and
// distance round the lap.
export const GHOST_RATE = 15;
const GS = 6;

/** A see-through copy of a car, for the ghost of a best lap. */
function ghostMesh(model) {
  const g = instance('cars', model);
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.transparent = true;
    o.material.opacity = 0.5;
    o.material.depthWrite = false;
    o.material.color?.setHex(0xd6f0ff);
    // A faint glow of its own, so it reads on dark tarmac and white snow.
    o.material.emissive?.setHex(0x3f7fb0);
    o.castShadow = false;
    o.receiveShadow = false;
  });
  g.renderOrder = 4;
  g.visible = false;
  return g;
}

export class Race {
  constructor({ engine, track, playerSpec, roster, difficulty = 1, trial = false, ghost = null, challenge = false }) {
    this.engine = engine;
    this.track = track;
    this.difficulty = difficulty;
    // Time trial: the player alone on the road, no item boxes, racing the
    // ghost of their own best lap.
    this.trial = trial;
    this.rng = mulberry32((track.def.seed || 1) * 7919 + 13);

    this.particles = new Particles(engine.world);
    this.skids = new SkidMarks(engine.world);
    this.snow = track.def.theme?.snowfall ? new Snowfall(engine.world) : null;
    this.camLead = 0;   // how far down the road the camera is looking, eased
    this.items = trial
      ? { boxes: [], update() {} }
      : new ItemField(track, engine.world, this.rng, [1, 0.7, 0.35, 0][difficulty] ?? 1);
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
        car.runoffEase = [1, 0.35, 0, 0][difficulty] ?? 0;
      } else {
        // Legend steps up further than the rest: at the old even spacing a
        // near-perfect driver still won six Legend races in ten.
        const base = [0.48, 0.65, 0.78, 0.9][difficulty] ?? 0.71;
        const skill = Math.min(0.99, base + this.rng() * 0.09);
        this.drivers.push(new AIDriver(car, track, {
          skill,
          aggression: 0.35 + this.rng() * 0.5,
          seed: Math.floor(this.rng() * 1e6),
          // Sliding the tight bends for the kick is part of the difficulty:
          // no rival does it at Rookie, every one at Legend.
          drift: this.rng() < ([0, 0.5, 0.8, 1][difficulty] ?? 0.5),
        }));
      }
    });

    for (const car of this.cars) car.onLand = (time, impact) => this.landed(car, time, impact);
    this.rivalMarker = this.buildRivalMarker();
    engine.world.add(this.rivalMarker);

    // The player hears and feels a drift build and pay out.
    if (this.player) {
      this.player.onDriftLevel = (level) => {
        this.playSfx(() => sfx.driftLevel(level));
        if (!this.autopilot) this.onTick?.();
      };
      this.player.onKick = (level) => {
        this.emit('boost', { level });
        this.playSfx(() => sfx.kick(level));
        this.buzz(0.15, 0.45, level === 2 ? 220 : 140);
      };
    }

    // The ghost to beat, and the lap being recorded to become the next one.
    this.ghost = null;
    // A friend's ghost from a link (ghostlink.js) stays the one to beat:
    // your own better lap does not take its place.
    this.challenge = trial && challenge;
    if (trial && ghost?.s?.length) this.setGhost(ghost);
    this.recording = [];
    this.delta = null;

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
    this.coolDown = false;   // the flag has taken the wheel
    this.itemBump = 0;       // last time a box was passed with a full slot
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
    this.autopilot = new AIDriver(this.player, this.track, { skill, aggression: 0.6, seed: 7, drift: true });
  }

  buildField(playerSpec, roster) {
    const pool = roster.filter((r) => r.id !== playerSpec.id);
    const picked = [];
    const rng = this.rng;
    while (picked.length < GRID - 1 && pool.length) {
      picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    }
    const player = { ...playerSpec, __player: true };
    if (this.trial) return [player];
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
    this.markerRing = ring;
    group.add(arrow, ring);
    group.renderOrder = 5;
    return group;
  }

  /** A smaller marker in red over the car to catch (or, leading, the one
   *  closing in behind, in orange). */
  buildRivalMarker() {
    const geo = new THREE.ConeGeometry(0.42, 0.8, 4);
    geo.rotateX(Math.PI);
    this.rivalMat = new THREE.MeshBasicMaterial({ color: 0xff4d6d });
    const m = new THREE.Mesh(geo, this.rivalMat);
    m.renderOrder = 5;
    m.visible = false;
    return m;
  }

  /** Wheels back down: dust, a thump, and for real air a kick. */
  landed(car, time, impact) {
    if (time < 0.12) return;
    const c = DUST[car.surface] ?? DUST.road;
    this.particles.burst(car.x, car.y + 0.2, car.z, Math.min(16, 4 + Math.round(time * 14)), {
      colour: c, size: 0.6, life: 0.55, spread: 4, up: 1.5, opacity: 0.5,
    });
    if (time >= BIG_AIR) {
      car.kick = Math.max(car.kick, DRIFT.kick[1]);
      car.kickLevel = 1;
    }
    if (car !== this.player) return;
    this.playSfx(() => sfx.land(Math.min(1, impact / 8)));
    this.engine.shake(Math.min(1.4, impact * 0.12));
    this.buzz(Math.min(1, impact / 8), 0.3, 120);
    if (time >= BIG_AIR) {
      this.emit('air', { time });
      this.message('BIG AIR!', 'good', 1.3);
      this.playSfx(() => sfx.kick(1));
    }
  }

  /** Driving under a bridge, the deck goes see-through — everything on it,
   *  road, rails and pillars together — so the cars below stay in sight. */
  fadeBridge(dt) {
    const p = this.player, meshes = this.track.bridgeMeshes;
    if (!p || !meshes?.length) return;
    let under = false;
    // Under it means the deck is overhead, not that the player is on the
    // ramp up to it.
    for (const q of this.track.bridgePts) {
      if (q.h - p.y > 2.5 && (q.x - p.x) ** 2 + (q.z - p.z) ** 2 < 13 * 13) { under = true; break; }
    }
    const want = under ? 0.25 : 1;
    this.bridgeFade = (this.bridgeFade ?? 1) + (want - (this.bridgeFade ?? 1)) * Math.min(1, dt * 6);
    for (const m of meshes) {
      m.material.opacity = this.bridgeFade;
      m.material.depthWrite = this.bridgeFade > 0.98;
    }
  }

  /** A rock arch the player is passing under thins out, so the car stays
   *  in sight. */
  fadeArches(dt) {
    const p = this.player;
    if (!p) return;
    for (const a of this.track.arches ?? []) {
      const near = Math.hypot(p.x - a.x, p.z - a.z) < 17;
      const want = near ? 0.25 : 1;
      a.mat.opacity += (want - a.mat.opacity) * Math.min(1, dt * 6);
      a.mat.depthWrite = a.mat.opacity > 0.98;
    }
  }

  /** Overtakes, close calls and the rival marker: the moment-to-moment
   *  feedback on how the race is going. */
  updateDuel(dt) {
    const p = this.player;
    if (!p || this.autopilot || this.phase === 'countdown') {
      this.rivalMarker.visible = false;
      return;
    }
    // A place gained and held for a moment is an overtake; a pass that is
    // undone at once, side by side, is not worth shouting about.
    if (this.heldPos == null) { this.heldPos = p.racePosition; this.posSince = 0; }
    if (p.racePosition !== this.pendingPos) { this.pendingPos = p.racePosition; this.posSince = 0; }
    this.posSince += dt;
    if (this.posSince > 0.35 && this.pendingPos !== this.heldPos) {
      if (this.pendingPos < this.heldPos && !p.finished && this.raceTime > 2.5) {
        this.message(`OVERTAKE! P${this.pendingPos}`, 'good', 1.2);
        this.emit('overtake');
        this.playSfx(sfx.overtake);
      }
      this.heldPos = this.pendingPos;
    }

    // Close calls: shaving past a car, faster than it, without touching.
    if (p.touching) this.lastTouch = this.raceTime;
    const f = p.forward;
    for (const other of this.cars) {
      if (other === p || other.finished || p.finished || Math.abs(other.y - p.y) > 2.2) continue;
      const rel = (p.vLong - (other.forward.x * f.x + other.forward.z * f.z) * other.vLong);
      if (rel < CLOSE.speed) continue;
      const gap = carGap(p, other);
      if (gap <= 0 || gap > CLOSE.gap) continue;
      if (this.raceTime - (this.lastTouch ?? -9) < 0.6) continue;
      if (this.raceTime - (other.closeCallAt ?? -99) < CLOSE.every) continue;
      other.closeCallAt = this.raceTime;
      if (p.kick < CLOSE.kick) { p.kick = CLOSE.kick; p.kickLevel = 1; }
      this.message('CLOSE CALL!', 'good', 1.0);
      this.emit('close');
      this.playSfx(sfx.closeCall);
      this.onTick?.();
    }

    // The rival marker.
    const ranked = this.standings ?? [];
    const target = p.racePosition > 1 ? ranked[p.racePosition - 2] : ranked[1];
    const show = target && !p.finished && Math.hypot(target.x - p.x, target.z - p.z) < 70;
    this.rivalMarker.visible = !!show;
    if (show) {
      this.rivalMat.color.setHex(p.racePosition > 1 ? 0xff4d6d : 0xffa62b);
      this.rivalMarker.position.set(target.x, target.y + 2.6 + Math.sin(this.raceTime * 5) * 0.12, target.z);
      this.rivalMarker.rotation.y = -this.raceTime * 1.6;
    }
  }

  start() {
    this.engineSound.start();
  }

  dispose() {
    this.engineSound.stop();
  }

  /** Race this lap from now on: `{ time, car, s }` as recorded below. */
  setGhost(ghost) {
    if (this.ghost?.mesh) this.engine.world.remove(this.ghost.mesh);
    // A ghost from a link comes without its lap distance.
    if (ghost.s.some((v, k) => k % GS === 5 && !Number.isFinite(v))) fillDistance(ghost, this.track);
    const mesh = ghostMesh(ghost.car);
    this.engine.world.add(mesh);
    this.ghost = { ...ghost, mesh, cursor: 0 };
  }

  /** Lap distance round from the line, in world units. */
  lapDistance(car) {
    const n = this.track.line.n;
    return ((((car.totalProgress - this.track.startIndex) % n) + n) % n) * this.track.line.spacing;
  }

  /** Record the player's lap; show the ghost where it was at this point of
   *  its lap; work out how far ahead of it (or behind) the player is. */
  updateTrial(dt) {
    const p = this.player;
    if (!this.trial || !p) return;
    const t = this.raceTime - p.lapStart;
    const live = p.crossedLine && !p.finished && this.phase !== 'countdown';
    if (live) {
      const rec = this.recording;
      const last = rec.length ? rec[rec.length - GS] : -1;
      if (t - last >= 1 / GHOST_RATE - 1e-6) {
        rec.push(+t.toFixed(3), +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.heading.toFixed(3), +this.lapDistance(p).toFixed(1));
      }
    }
    const g = this.ghost;
    if (!g) return;
    const s = g.s, count = s.length / GS;
    if (!live || t > g.time) { g.mesh.visible = false; this.delta = null; return; }
    // The ghost: walk the cursor to the sample at this time and blend.
    if (g.cursor > 0 && s[g.cursor * GS] > t) g.cursor = 0;
    while (g.cursor < count - 2 && s[(g.cursor + 1) * GS] <= t) g.cursor++;
    const a = g.cursor * GS, b = Math.min(count - 1, g.cursor + 1) * GS;
    const span = s[b] - s[a];
    const u = span > 0 ? Math.max(0, Math.min(1, (t - s[a]) / span)) : 0;
    let dh = s[b + 4] - s[a + 4];
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    g.mesh.position.set(s[a + 1] + (s[b + 1] - s[a + 1]) * u, s[a + 2] + (s[b + 2] - s[a + 2]) * u + 0.17, s[a + 3] + (s[b + 3] - s[a + 3]) * u);
    g.mesh.rotation.set(0, s[a + 4] + dh * u, 0);
    g.mesh.visible = this.showGhost !== false;
    // The delta: when did the ghost pass the distance the player is at now?
    const d = this.lapDistance(p);
    let lo = 0, hi = count - 1;
    if (d <= s[5]) { this.delta = null; return; }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid * GS + 5] < d) lo = mid; else hi = mid;
    }
    const d0 = s[lo * GS + 5], d1 = s[hi * GS + 5];
    const tg = s[lo * GS] + (d1 > d0 ? (d - d0) / (d1 - d0) : 0) * (s[hi * GS] - s[lo * GS]);
    this.delta = t - tg;
  }

  /** A moment for the trophies (achievements.js) — the player's own, at the wheel. */
  emit(name, data) {
    if (!this.autopilot) this.onEvent?.(name, data);
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
      this.particles.burst(car.x, car.y + 0.35, car.z, 14, {
        colour: [0.4, 1, 0.6], size: 0.5, life: 0.5, spread: 5, glow: true, opacity: 0.9,
      });
    } else if (kind === 'missile') {
      this.projectiles.push(new Projectile(car, this.engine.world));
      if (car === this.player) this.playSfx(sfx.missile);
    } else if (kind === 'mine') {
      // At most six drums down at once; a seventh clears the oldest away.
      const drums = this.projectiles.filter((pr) => pr instanceof Hazard && !pr.dead);
      if (drums.length >= 6) drums[0].dead = true;
      this.projectiles.push(new Hazard(car, this.engine.world));
      if (car === this.player) this.playSfx(sfx.select);
    }
  }

  update(dt, input) {
    if (this.phase === 'countdown' && !this.hinted && !this.autopilot) {
      this.hinted = true;
      if (launchHints > 0) {
        launchHints--;
        this.message(input.touch ? 'Rocket start: touch right as it goes green' : 'Rocket start: gas as it goes green', 'tip', 3.2);
      }
    }
    this.watchLaunch(input);
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
        this.playSfx(sfx.go);
        this.buzz(0.9, 0.7, 420);
        this.engine.shake(1.6);
        // Six cars leave the line in a cloud of their own tyre smoke.
        for (const c of this.cars) {
          const f = c.forward;
          this.particles.burst(c.x - f.x * 1.1, c.y + 0.25, c.z - f.z * 1.1, 14, {
            colour: [0.62, 0.62, 0.66], size: 0.9, life: 1.1, spread: 4, up: 2.5, opacity: 0.55,
          });
        }
        for (const c of this.cars) c.lapStart = 0;
        this.judgeLaunch(true);
      }
    } else if (this.phase === 'racing') {
      this.raceTime += dt;
    } else if (this.phase === 'finished') {
      this.raceTime += dt;
      this.postTime = (this.postTime || 0) + dt;
      this.emitCelebration(dt);
    }

    const racing = this.phase !== 'countdown';

    // The gantry lights fill red through the countdown and go green at the
    // start, then go dark again.
    if (this.phase === 'countdown') {
      this.track.setStartLights(Math.max(0, Math.min(5, Math.floor((this.clock + 3.6) / 0.66))));
    } else {
      this.track.setStartLights(this.raceTime < 1.8 ? 5 : 0, 0x3ddc84);
    }

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
      this.particles.burst(mx, (a.y + b.y) / 2 + 0.5, mz, 5, {
        colour: [1, 0.85, 0.4], size: 0.28, life: 0.35, spread: 4, glow: true, opacity: 1,
      });
    });

    for (const car of this.cars) {
      if (car.wallHit > 0.02 && car === this.player) {
        this.playSfx(sfx.wall);
        this.engine.shake(car.wallHit * 0.9);
        this.buzz(car.wallHit * 0.8, car.wallHit * 0.5, 130);
        this.particles.burst(car.x, car.y + 0.5, car.z, 4, {
          colour: [1, 0.9, 0.5], size: 0.22, life: 0.3, spread: 3, glow: true, opacity: 1,
        });
      }
    }

    this.items.update(dt, this.cars, (car, kind) => {
      // Anyone taking a box bursts in its colour; the player also hears it.
      const c = ITEMS[kind].rgb;
      this.particles.burst(car.x, car.y + 0.7, car.z, car === this.player ? 18 : 8, {
        colour: c, size: 0.5, life: 0.55, spread: 5.5, up: 5, glow: true, opacity: 0.95,
      });
      if (car === this.player) {
        this.playSfx(sfx.pickup);
        this.message(ITEMS[kind].label, 'item', 1.4);
        this.buzz(0.15, 0.4, 120);
      }
    }, (car) => {
      if (car !== this.player) return;
      this.playSfx(sfx.denied);
      this.itemBump = this.raceTime;   // the HUD rattles the slot
    });

    for (const proj of this.projectiles) {
      proj.update(dt, this.cars, this.track);
      if (proj.dead) {
        if (proj.hitCar) {
          this.playSfx(sfx.explode);
          this.particles.burst(proj.hitCar.x, proj.hitCar.y + 0.6, proj.hitCar.z, 22, {
            colour: [1, 0.6, 0.2], size: 0.55, life: 0.7, spread: 8, up: 6, glow: true, opacity: 1,
          });
          if (proj.hitCar === this.player) { this.engine.shake(1.8); this.buzz(1, 0.8, 420); }
          if (proj.owner === this.player && proj.hitCar !== this.player) {
            this.emit(proj instanceof Hazard ? 'oil' : 'hit');
            this.message('DIRECT HIT', 'good', 1.6);
          }
          if (proj.hitCar === this.player) this.message('SPUN OUT!', 'bad', 1.6);
        }
        proj.dispose(this.engine.world);
      }
    }
    this.projectiles = this.projectiles.filter((p2) => !p2.dead);

    this.updateStandings();
    this.updateDuel(dt);
    this.updateTrial(dt);
    this.fadeArches(dt);
    this.fadeBridge(dt);
    this.track.animate(dt);
    this.particles.update(dt);
    this.skids.update(dt);
    if (this.snow) this.snow.update(dt, this.engine.target);
    this.engine.decayShake(dt);

    // Player marker.
    if (p) {
      this.marker.position.set(p.x, p.y + 3.1 + Math.sin(this.raceTime * 4) * 0.16, p.z);
      // The ring stays on the ground: in the air, the gap to it is the height.
      const ground = this.track.line.heightAt(p.lineIndex) + 0.25;
      this.markerRing.position.y = (p.airborne ? ground : p.y + 0.25) - this.marker.position.y;
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
      // Height eased too, so a crest does not jolt the whole picture.
      this.camY = this.camY == null ? p.y : this.camY + (p.y - this.camY) * Math.min(1, dt * 4);
      e.look(p.x + f.x * this.camLead, this.camY, p.z + f.z * this.camLead);
      // Pull in close for the finish celebration, back out while racing —
      // and keep backing out under a turbo instead of capping at top speed.
      const targetZoom = CAMERA_ZOOM * (this.coolDown
        ? 27
        : 35 + Math.min(14, Math.abs(p.vLong) * 0.42));
      this.engine.setZoom(this.engine.viewSize + (targetZoom - this.engine.viewSize) * Math.min(1, dt * 2));
      this.particles.setScale(this.engine.renderer.domElement.height, this.engine.viewSize);
      // At the lights the car does not move, but the engine answers the pedal.
      this.engineSound.update(
        Math.min(1, Math.abs(p.vLong) / p.topSpeed),
        Math.max(0, racing || this.autopilot ? p.throttle : input.throttle),
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
        this.particles.burst(p.x + side * 2.5, p.y + 1.0, p.z, this.celebrate === 2 ? 22 : 14, {
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
        p.y + 3.6 + Math.random() * 2.8,
        p.z + (Math.random() - 0.5) * 9,
        {
          velocity: [(Math.random() - 0.5) * 3, -0.6, (Math.random() - 0.5) * 3],
          colour, size: 0.5, life: 1.9, grow: 0.22, rise: -2.6, drag: 0.6,
          glow: true, opacity: 1,
        },
      );
    }
  }

  /** A trial lap done: a new best becomes the ghost for the next one. */
  bookTrialLap(lapTime) {
    const rec = this.recording;
    this.recording = [];
    if (this.challenge) { this.bookChallengeLap(lapTime, rec); return; }
    const best = this.ghost?.time ?? Infinity;
    // A lap needs most of its samples to be a ghost worth keeping.
    if (lapTime >= best || rec.length / GS < lapTime * GHOST_RATE * 0.8) return;
    const ghost = { time: +lapTime.toFixed(3), car: this.player.spec.model, s: rec };
    const first = !this.ghost;
    this.setGhost(ghost);
    this.message(first ? 'LAP SET — NOW BEAT IT' : 'NEW BEST LAP!', 'good', 1.8);
    this.playSfx(sfx.lap);
    this.onBestLap?.(ghost);
  }

  /** A lap against a friend's ghost: say how it went; your own best still
   *  goes on the record, but the ghost on the road stays theirs. */
  bookChallengeLap(lapTime, rec) {
    const margin = lapTime - this.ghost.time;
    if (margin < 0) {
      this.challengeBeaten = true;
      this.message(`GHOST BEATEN BY ${(-margin).toFixed(2)}s!`, 'finish', 2.4);
      this.playSfx(sfx.lap);
    } else {
      this.message(`+${margin.toFixed(2)}s ON THE GHOST`, 'bad', 1.8);
    }
    this.bestChallengeLap = Math.min(this.bestChallengeLap ?? Infinity, lapTime);
    if (rec.length / GS >= lapTime * GHOST_RATE * 0.8) {
      this.onBestLap?.({ time: +lapTime.toFixed(3), car: this.player.spec.model, s: rec });
    }
  }

  /** Note when the player's launch input goes down round the green light. */
  watchLaunch(input) {
    if (!this.player || this.autopilot || this.launchJudged) return;
    const down = !!input.launch;
    const t = this.phase === 'countdown' ? this.clock : this.raceTime;
    if (down && !this.launchHeld) this.launchAt = t;
    if (!down) this.launchAt = null;
    this.launchHeld = down;
    // Just after green a late press can still catch the window.
    if (this.phase !== 'countdown') this.judgeLaunch(false);
  }

  /** Rocket start, wheelspin, or an ordinary getaway. */
  judgeLaunch(atGreen) {
    if (!this.player || this.autopilot || this.launchJudged) return;
    const p = this.player, at = this.launchAt;
    if (at != null && at < LAUNCH.from) {
      if (!atGreen) return;
      this.launchJudged = true;
      p.stall = LAUNCH.stall;
      this.message('WHEELSPIN', 'bad', 1.4);
      this.playSfx(sfx.wheelspin);
      this.particles.burst(p.x, p.y + 0.3, p.z, 16, {
        colour: [0.6, 0.6, 0.64], size: 0.9, life: 0.9, spread: 3, up: 2, opacity: 0.6,
      });
    } else if (at != null && at <= LAUNCH.to) {
      this.launchJudged = true;
      p.giveBoost(LAUNCH.boost);
      this.message('ROCKET START!', 'good', 1.6);
      this.emit('launch');
      this.playSfx(sfx.boost);
      this.buzz(0.6, 0.8, 300);
      this.onTick?.();
      this.particles.burst(p.x, p.y + 0.35, p.z, 18, {
        colour: [0.4, 1, 0.6], size: 0.5, life: 0.5, spread: 5, glow: true, opacity: 0.9,
      });
    } else if (!atGreen && this.raceTime > LAUNCH.to) {
      this.launchJudged = true;
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
    const strength = [0.7, 0.3, 0.1, 0][this.difficulty] ?? 0;
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
        if (other === car || Math.abs(other.y - car.y) > 2.2) continue;
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

    if (car.slip > 0.22 && speed > 4 && !car.airborne) {
      car.skidAccum = (car.skidAccum || 0) + dt;
      if (car.skidAccum > 0.022) {
        car.skidAccum = 0;
        for (const side of [-1, 1]) {
          this.skids.add(car.x + rx * side * 0.62 - f.x * 0.85, car.y + Math.tan(car.pitch) * 0.85, car.z + rz * side * 0.62 - f.z * 0.85, car.heading, car.pitch);
        }
      }
      if (Math.random() < car.slip * 0.7) {
        const c = DUST[car.surface];
        this.particles.emit(car.x - f.x * 1.2, car.y + 0.24, car.z - f.z * 1.2, {
          velocity: [(Math.random() - 0.5) * 3, 0.8 + Math.random(), (Math.random() - 0.5) * 3],
          colour: c, size: 0.42, life: 0.72, grow: 2.4, opacity: 0.5,
        });
      }
    }

    if (car.surface !== 'road' && car.surface !== 'ice' && speed > 3 && !car.airborne && Math.random() < 0.6) {
      this.particles.emit(car.x - f.x * 1.1, car.y + 0.2, car.z - f.z * 1.1, {
        velocity: [(Math.random() - 0.5) * 4, 1.6 + Math.random() * 2, (Math.random() - 0.5) * 4],
        colour: DUST[car.surface], size: 0.4, life: 0.6, grow: 2.6, opacity: 0.6,
      });
    }

    // Drift sparks off the rear wheels: blue once a kick is banked, orange
    // for the big one. Before that, nothing — the skid smoke is enough.
    if (car.drift && car.driftLevel > 0 && speed > 4) {
      const c = car.driftLevel === 2 ? [1, 0.62, 0.15] : [0.35, 0.72, 1];
      for (const side of [-1, 1]) {
        if (Math.random() < 0.25) continue;
        this.particles.emit(car.x + rx * side * 0.66 - f.x * 1.0, car.y + 0.22, car.z + rz * side * 0.66 - f.z * 1.0, {
          velocity: [(Math.random() - 0.5) * 3 - f.x * 2, 1.2 + Math.random() * 1.6, (Math.random() - 0.5) * 3 - f.z * 2],
          colour: c, size: car.driftLevel === 2 ? 0.62 : 0.5, life: 0.34, grow: 0.3, glow: true, opacity: 1,
        });
      }
    }
    // The kick out of a drift: a short flame in the same colour.
    if (car.kick > 0) {
      const c = car.kickLevel === 2 ? [1, 0.62, 0.15] : [0.35, 0.72, 1];
      this.particles.emit(car.x - f.x * 1.4, car.y + 0.36, car.z - f.z * 1.4, {
        velocity: [-f.x * 6 + (Math.random() - 0.5) * 2, 0.6, -f.z * 6 + (Math.random() - 0.5) * 2],
        colour: c, size: 0.42, life: 0.3, grow: 1.2, glow: true, opacity: 1,
      });
    }

    if (car.boost > 0) {
      this.particles.emit(car.x - f.x * 1.4, car.y + 0.36, car.z - f.z * 1.4, {
        velocity: [-f.x * 6 + (Math.random() - 0.5) * 2, 0.6, -f.z * 6 + (Math.random() - 0.5) * 2],
        colour: [0.45, 1, 0.75], size: 0.34, life: 0.32, grow: 1.4, glow: true, opacity: 1,
      });
    }

    if (car.spin > 0 && Math.random() < 0.8) {
      this.particles.emit(car.x, car.y + 0.5, car.z, {
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
      if (car === this.player) this.recording = [];
      return;
    }

    const lapTime = this.raceTime - car.lapStart;
    car.lapTimes.push(lapTime);
    car.lapStart = this.raceTime;
    car.lap += 1;
    if (this.trial && car === this.player) this.bookTrialLap(lapTime);

    if (car.lap > this.track.laps) {
      car.finished = true;
      car.finishTime = this.raceTime;
      this.finishOrder.push(car);
      if (car === this.player) {
        this.phase = 'finished';
        this.postTime = 0;
        this.playSfx(sfx.finish);
        if (!this.autopilot) {
          // The flag takes the wheel: a cool-down lap under the AI, so the
          // celebration is not spent watching yourself coast into a building.
          car.item = null;
          this.setAutopilot(true, 0.85);
          this.coolDown = true;
          const place = this.finishOrder.length;
          // Alone on the road there is no one to beat but the clock.
          const label = this.trial ? 'TIME!'
            : place === 1 ? 'WINNER!'
            : place === 2 ? '2ND PLACE!'
            : place === 3 ? '3RD PLACE!'
            : `FINISHED ${place}TH`;
          this.message(label, this.trial || place <= 3 ? 'finish' : 'go', 3.4);
          this.buzz(0.9, 0.6, place === 1 ? 650 : 380);
          this.celebrate = this.trial ? 0 : place === 1 ? 2 : place <= 3 ? 1 : 0;
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
      id: car.spec.id,
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
