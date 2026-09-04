// Pickups (item boxes) and the three things you can do with them.
import * as THREE from 'three';
import { instance } from './assets.js';

export const ITEMS = {
  boost: { label: 'TURBO', colour: '#4ade80', rgb: [0.29, 0.87, 0.5] },
  missile: { label: 'ROCKET', colour: '#f87171', rgb: [0.97, 0.44, 0.44] },
  mine: { label: 'OIL DRUM', colour: '#fbbf24', rgb: [0.98, 0.75, 0.14] },
};

// What a box hands out depends on where you are running: backmarkers draw
// comeback speed, the leader mostly draws things to defend with.
function deal(rng, racePosition) {
  const pos = racePosition ?? 4;
  const r = rng();
  if (pos >= 5) return r < 0.50 ? 'boost' : r < 0.82 ? 'missile' : 'mine';
  if (pos >= 3) return r < 0.34 ? 'boost' : r < 0.68 ? 'missile' : 'mine';
  return r < 0.16 ? 'boost' : r < 0.48 ? 'missile' : 'mine';
}

export class ItemField {
  constructor(track, scene, rng) {
    this.track = track;
    this.scene = scene;
    this.rng = rng;
    this.boxes = [];
    this.build();
  }

  build() {
    const line = this.track.line;
    const group = new THREE.Group();
    // Rows of three boxes on the straights.
    const spacing = Math.max(28, line.length / 7);
    for (let d = spacing * 0.5; d < line.length; d += spacing) {
      const i = Math.round(d / line.spacing);
      if (line.curveAt(i) > 0.025) continue;
      const p = line.point(i), t = line.tangent(i);
      for (let k = -1; k <= 1; k++) {
        const off = k * this.track.roadHalf * 0.62;
        const mesh = instance('items', 'item-box');
        mesh.scale.setScalar(4.4);
        mesh.position.set(p.x + t.z * off, 0.2, p.z - t.x * off);
        mesh.userData.baseY = 0.2;
        group.add(mesh);
        this.boxes.push({ mesh, x: mesh.position.x, z: mesh.position.z, cooldown: 0, blocked: 0, phase: this.rng() * 6.28 });
      }
    }
    this.group = group;
    this.scene.add(group);
  }

  update(dt, cars, onPickup, onBlocked) {
    for (const box of this.boxes) {
      // A box that was driven through with a full slot hops and is left
      // alone for a moment, so it does not rattle every frame of the pass.
      if (box.blocked > 0) {
        box.blocked -= dt;
        const t = Math.max(0, box.blocked / 0.5);
        box.mesh.position.y = box.mesh.userData.baseY + Math.sin(t * Math.PI) * 1.1;
        box.mesh.rotation.y += dt * 14;
        continue;
      }
      if (box.cooldown > 0) {
        box.cooldown -= dt;
        if (box.cooldown <= 0) { box.mesh.visible = true; box.mesh.scale.setScalar(4.4); }
        else {
          const t = 1 - box.cooldown / 4;
          box.mesh.visible = true;
          box.mesh.scale.setScalar(4.4 * Math.max(0, t * t));
        }
        continue;
      }
      box.phase += dt * 2.4;
      box.mesh.rotation.y += dt * 1.8;
      box.mesh.position.y = box.mesh.userData.baseY + Math.sin(box.phase) * 0.28;

      for (const car of cars) {
        if (car.finished) continue;
        if (Math.hypot(car.x - box.x, car.z - box.z) > 2.1) continue;
        if (car.item) {
          box.blocked = 0.5;
          onBlocked && onBlocked(car);
          break;
        }
        box.cooldown = 4;
        box.mesh.visible = false;
        const kind = deal(this.rng, car.racePosition);
        car.item = kind;
        onPickup && onPickup(car, kind);
        break;
      }
    }
  }
}

export class Projectile {
  constructor(owner, scene) {
    this.owner = owner;
    this.x = owner.x; this.z = owner.z;
    const f = owner.forward;
    this.heading = owner.heading;
    this.speed = Math.max(30, owner.vLong + 22);
    this.life = 3.2;
    this.dead = false;
    this.mesh = instance('cars', 'debris-bolt');
    this.mesh.scale.setScalar(3.2);
    this.mesh.position.set(this.x + f.x * 2, 0.5, this.z + f.z * 2);
    scene.add(this.mesh);
    this.x = this.mesh.position.x; this.z = this.mesh.position.z;
  }

  update(dt, cars, track) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }

    // Gentle homing onto the nearest car ahead keeps rockets satisfying.
    const target = this.findTarget(cars);
    if (target) {
      let want = Math.atan2(target.x - this.x, target.z - this.z) - this.heading;
      while (want > Math.PI) want -= Math.PI * 2;
      while (want < -Math.PI) want += Math.PI * 2;
      this.heading += Math.max(-2.6 * dt, Math.min(2.6 * dt, want));
    }
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
    this.mesh.position.set(this.x, 0.5, this.z);
    this.mesh.rotation.y = this.heading;
    this.mesh.rotation.x += dt * 14;

    for (const car of cars) {
      if (car === this.owner || car.finished) continue;
      if (Math.hypot(car.x - this.x, car.z - this.z) < car.radius + 0.8) {
        car.spinOut(1.25);
        this.dead = true;
        this.hitCar = car;
        return;
      }
    }
    const loc = track.line.locate(this.x, this.z, null, 0);
    if (loc.dist > track.wallHalf + 3) this.dead = true;
  }

  findTarget(cars) {
    let best = null, bestD = 42;
    for (const car of cars) {
      if (car === this.owner || car.finished) continue;
      const dx = car.x - this.x, dz = car.z - this.z;
      const ahead = dx * Math.sin(this.heading) + dz * Math.cos(this.heading);
      if (ahead < 1) continue;
      const d = Math.hypot(dx, dz);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  dispose(scene) { scene.remove(this.mesh); }
}

// None of the Kenney kits ship a barrel, so the oil drum is built here: a
// yellow drum with two dark hoops, matching the HUD icon, standing in the
// slick it has already leaked. One set of geometry serves every drum.
const DRUM = {
  body: new THREE.CylinderGeometry(0.55, 0.55, 1.25, 16),
  hoop: new THREE.CylinderGeometry(0.6, 0.6, 0.09, 16),
  lid: new THREE.CylinderGeometry(0.46, 0.46, 0.06, 16),
  slick: new THREE.CircleGeometry(1.7, 24),
  yellow: new THREE.MeshLambertMaterial({ color: 0xe8ac1f }),
  dark: new THREE.MeshLambertMaterial({ color: 0x2b3145 }),
  oil: new THREE.MeshBasicMaterial({ color: 0x0c0f16, transparent: true, opacity: 0.72, depthWrite: false }),
};

function oilDrum() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(DRUM.body, DRUM.yellow);
  body.position.y = 0.625;
  body.castShadow = true;
  g.add(body);
  for (const y of [0.3, 0.95]) {
    const hoop = new THREE.Mesh(DRUM.hoop, DRUM.dark);
    hoop.position.y = y;
    g.add(hoop);
  }
  const lid = new THREE.Mesh(DRUM.lid, DRUM.dark);
  lid.position.y = 1.26;
  g.add(lid);
  const slick = new THREE.Mesh(DRUM.slick, DRUM.oil);
  slick.rotation.x = -Math.PI / 2;
  slick.position.y = 0.13;   // the tarmac strip sits at 0.11 and its dashes just above; the slick goes on top of both
  slick.renderOrder = 2;
  g.add(slick);
  return g;
}

export class Hazard {
  constructor(owner, scene) {
    const f = owner.forward;
    this.x = owner.x - f.x * 3.4;
    this.z = owner.z - f.z * 3.4;
    this.owner = owner;
    this.arm = 0.8;
    this.life = 22;
    this.dead = false;
    this.mesh = oilDrum();
    this.mesh.position.set(this.x, 0.02, this.z);
    this.mesh.rotation.y = Math.random() * 6.28;
    scene.add(this.mesh);
  }

  update(dt, cars) {
    this.arm -= dt;
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.mesh.position.y = 0.02 + Math.sin(this.life * 6) * 0.015;
    for (const car of cars) {
      if ((this.arm > 0 && car === this.owner) || car.finished) continue;
      if (Math.hypot(car.x - this.x, car.z - this.z) < car.radius + 1.0) {
        car.spinOut(1.0);
        this.dead = true;
        this.hitCar = car;
        return;
      }
    }
  }

  dispose(scene) { scene.remove(this.mesh); }
}
