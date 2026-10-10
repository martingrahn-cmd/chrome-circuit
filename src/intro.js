// The opening titles: a race filmed rather than played, cut to the beat of
// the title song, closing on the title as the camera cranes up into the
// game's own view. Eight seconds; any button skips.
//
// It films the race that then runs behind the menu, through a perspective
// camera of its own. The last shot rises along the isometric axis while the
// lens narrows, until it frames exactly what the orthographic camera does,
// so handing over to the menu does not jump.
import * as THREE from 'three';
import { ISO_DIR } from './engine.js';
import * as music from './music.js';
import * as audio from './audio.js';

// KARTS! runs at about 174.5 bpm, and every cut lands on a beat.
const BEAT = 60 / 174.5;
export const LENGTH = 24 * BEAT;

/** The lines that slam in over the shots, from beat `at` to `until`. */
const CARDS = [
  { at: 0.5, until: 3.7, text: 'GameVolt presents', kind: 'small' },
  { at: 4, until: 7.7, text: '4 worlds' },
  { at: 8, until: 11.7, text: '12 circuits' },
  { at: 12, until: 13, text: 'No' },
  { at: 13, until: 14, text: 'brakes.' },
  { at: 14, until: 15, text: 'No' },
  { at: 15, until: 16, text: 'mercy.' },
];
const TITLE = 16;            // the beat the title lands on
const RISE = [16, 22];       // the crane up into the game's view
const OPEN = 21;             // the letterbox opens
const UP = new THREE.Vector3(0, 1, 0);
// How far inside the road's edge a low camera keeps, and how high it must be
// to look over what stands beside the road instead.
const EDGE = 0.35;
const CLEAR = 4;
// Closer to a car than this and the camera would be inside it.
const NEAR = 1.8;

const smooth = (u) => u * u * u * (u * (u * 6 - 15) + 10);
const clamp01 = (u) => Math.max(0, Math.min(1, u));

export class Intro {
  constructor(engine, race, el) {
    this.engine = engine;
    this.race = race;
    this.el = el;
    this.camera = new THREE.PerspectiveCamera(50, engine.aspect, 0.1, 900);
    this.t = 0;
    this.born = performance.now();
    this.sync = null;        // locked to the song's clock, or to frames when there is no song
    this.shot = -1;
    this.card = null;
    this.heading = 0;
    this.lift = 0;
    this.pos = new THREE.Vector3();
    this.at = new THREE.Vector3();
    this.anchor = new THREE.Vector3();
    this.v = new THREE.Vector3();
    race.filming = true;
    el.classList.remove('titled', 'open');
    el.querySelector('.intro-card').textContent = '';
  }

  get done() { return this.t >= LENGTH; }

  /** Seconds on screen, whatever the song is doing. */
  get age() { return (performance.now() - this.born) / 1000; }

  /** Over: the race goes on behind the menu, as itself again. */
  finish() { this.race.filming = false; }

  /** Advance by a frame: the song's clock when it is playing, else the frame's. */
  tick(dt) {
    const m = music.elapsed();
    if (this.sync === null) {
      if (m !== null) this.sync = true;
      else if (this.age > 1.2) this.sync = false;
    }
    if (this.sync === true && m !== null) this.t = Math.max(this.t, m);
    else if (this.sync === false) this.t += dt;
    this.film(dt);
    this.overlay();
  }

  /* -------------------------------------------------------------- shots */

  frameOf(car) {
    const h = this.heading;
    const f = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
    const r = new THREE.Vector3(f.z, 0, -f.x);
    return { c: new THREE.Vector3(car.x, car.y, car.z), f, r };
  }

  /** A new shot: who it follows, and where a fixed camera stands. */
  cut(shot) {
    const race = this.race, lead = race.player;
    this.shot = shot;
    if (shot >= 3 && shot <= 6 && !this.pack) {
      // The close-ups go down the pack round the leader.
      this.pack = race.cars.filter((c) => c !== lead)
        .sort((a, b) => Math.hypot(a.x - lead.x, a.z - lead.z) - Math.hypot(b.x - lead.x, b.z - lead.z))
        .slice(0, 4);
    }
    this.subject = shot >= 3 && shot <= 6 ? this.pack[shot - 3] || lead : lead;
    this.heading = this.subject.heading;
    // The side of the road with less of the pack on it, so no car drives
    // through the lens.
    const crowd = race.cars.reduce((n, c) => n + Math.sign(c.lateral || 0), 0);
    this.side = crowd > 0 ? -1 : 1;
    if (shot === 0) {
      // Stand at the edge of the road a second or so ahead, and let the pack go by.
      const line = race.track.line, here = line.locate(lead.x, lead.z).index;
      const ahead = Math.max(14, Math.min(40, Math.abs(lead.vLong) * 1.15));
      const i = here + Math.round(ahead / line.spacing);
      const p = line.point(i), tg = line.tangent(i);
      const off = this.side * (race.track.roadHalf - EDGE);
      this.anchor.set(p.x + tg.z * off, line.heightOf(i) + 0.8, p.z - tg.x * off);
    }
    if (shot > 0) this.flash(shot === 7 ? 'big' : '');
    if (shot === 7) audio.thump({ dur: 0.9, gain: 0.55, cutoff: 1300 });
  }

  film(dt) {
    const b = this.t / BEAT;
    const shot = b < 4 ? 0 : b < 8 ? 1 : b < 12 ? 2 : b < 16 ? 3 + Math.floor(b - 12) : 7;
    if (shot !== this.shot) this.cut(shot);
    const car = this.subject;
    // Follow the heading softly, so a twitch of the wheel is not a jolt.
    let dh = car.heading - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.heading += dh * Math.min(1, dt * 5);
    const { c, f, r } = this.frameOf(car);
    const cam = this.camera, pos = this.pos, at = this.at;
    const wobble = 0.05 * Math.sin(this.t * 11) + 0.03 * Math.sin(this.t * 23);
    let fov = 50;

    if (shot === 0) {
      // Low at the roadside, panning as they pass.
      pos.copy(this.anchor);
      at.copy(c).addScaledVector(UP, 0.5);
      fov = 46;
    } else if (shot === 1) {
      // Alongside, drifting forward.
      const u = b - 4;
      pos.copy(c).addScaledVector(r, this.side * 3.6).addScaledVector(f, -1 + u * 0.5).addScaledVector(UP, 1.5 + wobble);
      at.copy(c).addScaledVector(f, 2.2).addScaledVector(UP, 0.45);
      fov = 42;
    } else if (shot === 2) {
      // Ahead and low, backing off as the car closes in, the pack behind it.
      const u = (b - 8) / 4;
      pos.copy(c).addScaledVector(f, 8.5 - u * 3).addScaledVector(r, 1.3).addScaledVector(UP, 0.85 + wobble);
      at.copy(c).addScaledVector(f, -3).addScaledVector(UP, 0.5);
      fov = 46;
    } else if (shot <= 6) {
      // A close-up a beat long, either side by turn, pushing in.
      const u = b - Math.floor(b);
      const side = shot % 2 ? 1 : -1;
      pos.copy(c).addScaledVector(r, side * 2.3 * (1 - u * 0.15)).addScaledVector(f, 1.9).addScaledVector(UP, 0.65);
      at.copy(c).addScaledVector(f, 0.3).addScaledVector(UP, 0.35);
      fov = 38;
    } else {
      // Behind and above, then up the isometric axis into the game's view.
      const e = smooth(clamp01((b - RISE[0]) / (RISE[1] - RISE[0])));
      const from = this.v.copy(c).addScaledVector(f, -8).addScaledVector(UP, 3.2);
      const look0 = new THREE.Vector3().copy(c).addScaledVector(f, 3);
      const target = this.engine.target;
      at.lerpVectors(look0, target, e);
      const d0 = from.distanceTo(look0), d1 = 220;
      const dir = from.sub(look0).normalize().lerp(ISO_DIR, e).normalize();
      const dist = Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * e);
      pos.copy(at).addScaledVector(dir, dist);
      // Keep the framing growing steadily from the chase to the game's own.
      const h0 = 2 * d0 * Math.tan(THREE.MathUtils.degToRad(55) / 2);
      const h = Math.exp(Math.log(h0) + (Math.log(this.engine.viewSize) - Math.log(h0)) * e);
      fov = THREE.MathUtils.radToDeg(2 * Math.atan(h / (2 * dist)));
      cam.near = Math.max(0.1, dist - 150);
      cam.far = dist + 600;
    }
    if (shot < 7) { cam.near = 0.1; cam.far = 600; }
    this.keepOnRoad(pos, car);
    this.dodge(pos, dt);
    cam.fov = fov;
    cam.aspect = this.engine.aspect;
    cam.position.copy(pos);
    cam.lookAt(at);
    cam.updateProjectionMatrix();
  }

  /** Low down, the camera stays between the barriers: past them it would be
   *  inside the armco, the fences and the kerbside clutter. */
  keepOnRoad(pos, car) {
    const track = this.race.track, line = track.line;
    const loc = line.locate(pos.x, pos.z, car.lineIndex, 40);
    const room = track.roadHalf - EDGE;
    if (Math.abs(loc.lateral) <= room || pos.y - line.heightOf(loc.index) > CLEAR) return;
    const pull = loc.lateral - Math.sign(loc.lateral) * room;
    pos.x -= loc.tangent.z * pull;
    pos.z += loc.tangent.x * pull;
  }

  /** A car about to drive through the lens: the camera lifts clear of it,
   *  like a jib swinging up, and settles back once it has gone by. */
  dodge(pos, dt) {
    let want = 0;
    for (const c of this.race.cars) {
      if (pos.y - c.y > CLEAR) continue;
      // The nearest the car comes to the lens over the next quarter second.
      const f = c.forward, dx = pos.x - c.x, dz = pos.z - c.z;
      const s = Math.max(0, Math.min(Math.max(0, c.vLong * 0.25), dx * f.x + dz * f.z));
      const d = Math.hypot(dx - f.x * s, dz - f.z * s);
      want = Math.max(want, (NEAR - d) * 1.8);
    }
    // Up at once, down gently.
    this.lift = want > this.lift ? want : this.lift + (want - this.lift) * Math.min(1, dt * 3);
    pos.y += this.lift;
  }

  /* ------------------------------------------------------------ overlay */

  flash(kind) {
    const el = this.el.querySelector('.intro-flash');
    el.className = 'intro-flash';
    void el.offsetWidth;                      // restart the animation
    el.classList.add('go', ...(kind ? [kind] : []));
  }

  overlay() {
    const b = this.t / BEAT;
    const card = CARDS.find((c) => b >= c.at && b < c.until) || null;
    if (card !== this.card) {
      this.card = card;
      const el = this.el.querySelector('.intro-card');
      el.className = 'intro-card';
      el.textContent = card ? card.text : '';
      if (card) {
        void el.offsetWidth;
        el.classList.add('in', ...(card.kind ? [card.kind] : []));
      }
    }
    this.el.classList.toggle('titled', b >= TITLE);
    this.el.classList.toggle('open', b >= OPEN);
  }
}
