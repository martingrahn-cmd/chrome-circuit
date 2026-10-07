// In-race HUD: readouts, messages and the minimap.
import { ITEMS } from './items.js';

const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

export function formatTime(s) {
  if (s == null) return '--:--.--';
  // Round to centiseconds before splitting so 59.996s reads 1:00.00, not 0:60.00.
  const cs = Math.round(s * 100);
  const m = Math.floor(cs / 6000);
  const rest = (cs % 6000) / 100;
  return `${m}:${rest.toFixed(2).padStart(5, '0')}`;
}

export class Hud {
  constructor(root) {
    this.root = root;
    this.lap = root.querySelector('#hud-lap');
    this.pos = root.querySelector('#hud-pos');
    this.posLabel = root.querySelector('#hud-pos-label');
    this.posName = root.querySelector('#hud-pos-name');
    this.trial = null;
    this.speedScale = 9.4;
    this.unit = root.querySelector('#hud-unit');
    this.speed = root.querySelector('#hud-speed');
    this.time = root.querySelector('#hud-time');
    this.best = root.querySelector('#hud-best');
    this.item = root.querySelector('#hud-item');
    this.itemLabel = root.querySelector('#hud-item-label');
    this.itemIcon = root.querySelector('#hud-item-icon');
    this.item.addEventListener('animationend', () => this.item.classList.remove('pop', 'shake'));
    this.shownItem = null;
    this.level = '';
    this.shownPosLabel = null;
    this.seenBump = 0;
    this.itemHint = root.querySelector('#hud-item .item-hint');
    this.messages = root.querySelector('#hud-messages');
    this.countdown = root.querySelector('#hud-countdown');
    this.boostBar = root.querySelector('#hud-boost');
    this.draft = root.querySelector('#hud-draft');
    this.canvas = root.querySelector('#hud-map');
    this.ctx = this.canvas.getContext('2d');
    this.shownMessages = new Map();
  }

  /** Show the button that actually fires the item on this device. */
  setControlHint(text) {
    if (this.itemHint) this.itemHint.textContent = text;
  }

  prepareMap(track) {
    const pts = track.line.pts;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 12;
    const w = this.canvas.width, h = this.canvas.height;
    const sx = (w - pad * 2) / (maxX - minX || 1);
    const sz = (h - pad * 2) / (maxZ - minZ || 1);
    const s = Math.min(sx, sz);
    this.map = {
      s,
      ox: pad + (w - pad * 2 - (maxX - minX) * s) / 2 - minX * s,
      oz: pad + (h - pad * 2 - (maxZ - minZ) * s) / 2 - minZ * s,
      pts,
      startIndex: track.startIndex,
    };
  }

  drawMap(race) {
    const m = this.map;
    if (!m) return;
    const g = this.ctx;
    const { width: w, height: h } = this.canvas;
    g.clearRect(0, 0, w, h);

    g.beginPath();
    for (let i = 0; i <= m.pts.length; i++) {
      const p = m.pts[i % m.pts.length];
      const x = m.ox + p.x * m.s, y = m.oz + p.z * m.s;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.lineWidth = 7;
    g.lineJoin = 'round';
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 2;
    g.setLineDash([4, 6]);
    g.stroke();
    g.setLineDash([]);

    const sp = m.pts[m.startIndex];
    g.fillStyle = '#fde047';
    g.fillRect(m.ox + sp.x * m.s - 3, m.oz + sp.z * m.s - 3, 6, 6);

    for (const car of race.cars) {
      const x = m.ox + car.x * m.s, y = m.oz + car.z * m.s;
      g.beginPath();
      g.arc(x, y, car === race.player ? 4.5 : 3.2, 0, Math.PI * 2);
      g.fillStyle = car === race.player ? '#ffffff' : (car.spec.colour || '#94a3b8');
      g.fill();
      if (car === race.player) {
        g.lineWidth = 2;
        g.strokeStyle = '#111827';
        g.stroke();
      }
    }
  }

  /** km/h or mph on the speedo. */
  setUnits(units) {
    this.speedScale = units === 'mph' ? 9.4 * 0.6214 : 9.4;
    if (this.unit) this.unit.textContent = units === 'mph' ? 'mph' : 'km/h';
  }

  /** Time trial: the position box shows the gap to the ghost instead, and
   *  under it the next medal still to win. `medals` is [{ name, time }]. */
  setTrial(medals) {
    this.trial = medals;
    this.posName.textContent = medals ? 'Delta' : 'Pos';
    if (!medals) this.pos.classList.remove('is-ahead', 'is-behind');
  }

  update(race) {
    const p = race.player;
    const t = race.track;
    this.lap.textContent = `${Math.min(p.lap, t.laps)}/${t.laps}`;
    let posLabel;
    if (this.trial) {
      const d = race.delta;
      this.pos.textContent = d == null ? '—' : `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}`;
      this.pos.classList.toggle('is-ahead', d != null && d < 0);
      this.pos.classList.toggle('is-behind', d != null && d >= 0);
      const best = race.ghost?.time ?? Infinity;
      const next = this.trial.find((m) => best > m.time);
      posLabel = next ? `${next.name} ${next.time.toFixed(1)}` : 'Gold ✓';
    } else {
      this.pos.textContent = ORDINAL[p.racePosition] || `${p.racePosition}th`;
      posLabel = `of ${race.cars.length}${this.level ? ` · ${this.level}` : ''}`;
    }
    if (posLabel !== this.shownPosLabel) {
      this.posLabel.innerHTML = posLabel;
      this.shownPosLabel = posLabel;
    }
    this.speed.textContent = Math.round(Math.abs(p.vLong) * this.speedScale);
    this.time.textContent = formatTime(race.raceTime - p.lapStart);
    // In a time trial the best to show is the ghost's: the lap on record.
    const best = Math.min(p.lapTimes.length ? Math.min(...p.lapTimes) : Infinity, race.trial ? race.ghost?.time ?? Infinity : Infinity);
    this.best.textContent = formatTime(Number.isFinite(best) ? best : null);

    if (p.item) {
      const it = ITEMS[p.item];
      this.item.dataset.kind = p.item;
      this.item.classList.add('has-item');
      this.itemLabel.textContent = it.label;
      this.itemIcon.setAttribute('href', `#ico-${p.item}`);
      if (this.shownItem !== p.item) { this.item.classList.remove('shake'); this.item.classList.add('pop'); }
    } else {
      this.item.classList.remove('has-item');
      this.itemLabel.textContent = '—';
      this.item.dataset.kind = '';
      this.itemIcon.setAttribute('href', '');
    }
    this.shownItem = p.item;
    // Rattled: the race notes a box passed with the slot already full.
    if (race.itemBump !== this.seenBump) {
      this.seenBump = race.itemBump;
      this.item.classList.remove('pop');
      void this.item.offsetWidth;   // restart the animation if it is mid-way
      this.item.classList.add('shake');
    }

    this.boostBar.style.transform = `scaleX(${Math.min(1, p.boost / 2.1)})`;
    this.draft.classList.toggle('on', p.draft > 0.3 && p.boost <= 0);

    if (race.phase === 'countdown') {
      const n = Math.ceil(-race.clock);
      const on = n > 0 && n <= 3;
      this.countdown.textContent = on ? String(n) : '';
      if (on && n !== this.lastCount) {
        // Swapping textContent doesn't restart the pop animation — drop the
        // class and force a reflow so every digit plays, not just the first.
        this.countdown.classList.remove('show');
        void this.countdown.offsetWidth;
        this.countdown.dataset.n = n;
        this.countdown.classList.add('show');
      } else if (!on) {
        this.countdown.classList.remove('show');
      }
      this.lastCount = on ? n : 0;
    } else if (race.phase === 'racing' && race.raceTime < 0.9 && !race.autopilot) {
      // The digits give way to GO! bursting out of the same spot.
      if (this.lastCount !== -1) {
        this.countdown.textContent = 'GO!';
        this.countdown.classList.remove('show');
        void this.countdown.offsetWidth;
        this.countdown.dataset.n = 'go';
        this.countdown.classList.add('show');
        this.lastCount = -1;
      }
    } else {
      this.countdown.classList.remove('show');
      this.lastCount = 0;
    }

    // Messages: add new ones, drop expired.
    for (const msg of race.messages) {
      if (this.shownMessages.has(msg)) continue;
      const el = document.createElement('div');
      el.className = `hud-msg hud-msg--${msg.kind}`;
      el.textContent = msg.text;
      this.messages.appendChild(el);
      this.shownMessages.set(msg, el);
    }
    for (const [msg, el] of this.shownMessages) {
      if (!race.messages.includes(msg)) {
        el.remove();
        this.shownMessages.delete(msg);
      }
    }

    this.drawMap(race);
  }

  /** The difficulty, as markup, shown beside the position all race. */
  setLevel(html) {
    this.level = html;
  }

  reset() {
    this.messages.replaceChildren();
    this.shownMessages.clear();
  }
}
