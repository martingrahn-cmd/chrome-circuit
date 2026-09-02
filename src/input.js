// Keyboard, gamepad and on-screen touch controls collapsed into one state.

const DEADZONE = 0.18;
const REPEAT_FIRST = 0.42;
const REPEAT_NEXT = 0.13;

// Standard gamepad mapping.
const BTN = { confirm: 0, back: 1, item: 2, itemAlt: 3, handbrake: 5, brake: 6, gas: 7, start: 9 };
const DPAD = { up: 12, down: 13, left: 14, right: 15 };

/** Deadzone plus a mild curve, so small stick movements steer gently. */
function axis(v) {
  const m = Math.abs(v);
  if (m < DEADZONE) return 0;
  const t = (m - DEADZONE) / (1 - DEADZONE);
  return Math.sign(v) * t ** 1.35;
}

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { steer: 0, item: false, handbrake: false, auto: false };
    this.menuQueue = [];
    this.held = new Map();      // menu direction/button -> seconds held
    this.padId = null;
    this.onPadChange = null;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      // A focused menu button keeps its native Space activation.
      if (k === ' ' && document.activeElement?.tagName === 'BUTTON') return;
      this.keys.add(k);
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());

    addEventListener('gamepadconnected', (e) => {
      this.padId = e.gamepad.id;
      this.onPadChange?.(true, e.gamepad.id);
    });
    addEventListener('gamepaddisconnected', () => {
      this.padId = null;
      this.onPadChange?.(false, null);
    });
  }

  has(...names) { return names.some((n) => this.keys.has(n)); }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  hasPad() { return this.pad() !== null; }

  /** Driving input, merged from every source. */
  read() {
    let steer = 0, throttle = 0, item = false, handbrake = false;
    if (this.has('arrowleft', 'a')) steer -= 1;
    if (this.has('arrowright', 'd')) steer += 1;
    if (this.has('arrowup', 'w')) throttle += 1;
    if (this.has('arrowdown', 's')) throttle -= 1;
    if (this.has(' ')) item = true;
    if (this.has('shift')) handbrake = true;

    const p = this.pad();
    if (p) {
      steer += axis(p.axes[0] ?? 0);
      if (p.buttons[DPAD.left]?.pressed) steer -= 1;
      if (p.buttons[DPAD.right]?.pressed) steer += 1;

      const gas = p.buttons[BTN.gas]?.value ?? 0;
      const brake = p.buttons[BTN.brake]?.value ?? 0;
      if (gas > 0.06) throttle += gas;
      if (brake > 0.06) throttle -= brake;
      if (p.buttons[BTN.confirm]?.pressed) throttle += 1;
      if (p.buttons[DPAD.up]?.pressed) throttle += 1;
      if (p.buttons[DPAD.down]?.pressed) throttle -= 1;
      if (p.buttons[BTN.item]?.pressed || p.buttons[BTN.itemAlt]?.pressed) item = true;
      if (p.buttons[BTN.handbrake]?.pressed) handbrake = true;
    }

    steer += this.touch.steer;
    // On-screen driving has no pedal: the car drives itself, unless a pad is
    // plugged in, whose triggers then take over.
    if (this.touch.auto && !p) throttle += 1;
    if (this.touch.item) item = true;
    if (this.touch.handbrake) handbrake = true;

    return {
      steer: Math.max(-1, Math.min(1, steer)),
      throttle: Math.max(-1, Math.min(1, throttle)),
      item,
      handbrake,
    };
  }

  /**
   * Edge-triggered menu actions from the pad, with hold-to-repeat on the
   * directions. Keyboard menu keys are handled separately via keydown.
   */
  menuActions(dt) {
    const p = this.pad();
    const out = [];
    const edge = (name, active, repeat) => {
      const prev = this.held.get(name);
      if (!active) { this.held.delete(name); return; }
      if (prev === undefined) { this.held.set(name, 0); out.push(name); return; }
      if (!repeat) { this.held.set(name, prev + dt); return; }
      const t = prev + dt;
      const threshold = prev < REPEAT_FIRST ? REPEAT_FIRST : REPEAT_FIRST + REPEAT_NEXT;
      if (t >= threshold) {
        this.held.set(name, prev < REPEAT_FIRST ? REPEAT_FIRST : REPEAT_FIRST);
        out.push(name);
      } else {
        this.held.set(name, t);
      }
    };
    if (!p) { this.held.clear(); return out; }

    const ax = axis(p.axes[0] ?? 0), ay = axis(p.axes[1] ?? 0);
    edge('left', p.buttons[DPAD.left]?.pressed || ax < -0.5, true);
    edge('right', p.buttons[DPAD.right]?.pressed || ax > 0.5, true);
    edge('up', p.buttons[DPAD.up]?.pressed || ay < -0.5, true);
    edge('down', p.buttons[DPAD.down]?.pressed || ay > 0.5, true);
    edge('confirm', !!p.buttons[BTN.confirm]?.pressed, false);
    edge('back', !!p.buttons[BTN.back]?.pressed, false);
    edge('start', !!p.buttons[BTN.start]?.pressed, false);
    return out;
  }

  /** Fire-and-forget haptics; silently ignored on pads without an actuator. */
  rumble(strong = 0.4, weak = 0.2, ms = 140) {
    const p = this.pad();
    const actuator = p?.vibrationActuator;
    if (!actuator?.playEffect) return;
    actuator.playEffect('dual-rumble', {
      duration: ms,
      strongMagnitude: Math.min(1, strong),
      weakMagnitude: Math.min(1, weak),
    }).catch(() => { /* pad went away mid-effect */ });
  }

  /** Wire the on-screen controls (phones). Steering is a slide anywhere on
   *  the left half — the thumb's distance from where it landed is the input,
   *  so there is no stick to find — the right half is the handbrake while it
   *  is held, and the one real button fires the item. Each control tracks its
   *  own pointer, so a second finger never cancels the first. */
  bindTouch(root) {
    const RANGE = 56;   // px of slide for full lock
    // Capture keeps the up/move events coming once a thumb wanders off the
    // element; a pointer the browser has already lost makes this throw, and
    // the control must still have registered the press.
    const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch { /* fine */ } };
    const zone = root.querySelector('[data-touch="steer"]');
    const stick = root.querySelector('#touch-stick');
    let steerId = null, x0 = 0;
    const endSteer = (e) => {
      if (e.pointerId !== steerId) return;
      steerId = null;
      this.touch.steer = 0;
      stick?.classList.add('hidden');
    };
    zone?.addEventListener('pointerdown', (e) => {
      if (steerId !== null) return;
      e.preventDefault();
      steerId = e.pointerId;
      x0 = e.clientX;
      this.touch.steer = 0;
      capture(zone, e);
      if (stick) {
        stick.style.left = `${e.clientX}px`;
        stick.style.top = `${e.clientY}px`;
        stick.style.setProperty('--x', '0px');
        stick.classList.remove('hidden');
      }
    });
    zone?.addEventListener('pointermove', (e) => {
      if (e.pointerId !== steerId) return;
      const v = Math.max(-1, Math.min(1, (e.clientX - x0) / RANGE));
      // A touch of curve, like the pad stick, so small corrections stay small.
      this.touch.steer = Math.sign(v) * Math.abs(v) ** 1.2;
      stick?.style.setProperty('--x', `${v * 30}px`);
    });
    zone?.addEventListener('pointerup', endSteer);
    zone?.addEventListener('pointercancel', endSteer);

    const hold = (name) => {
      const el = root.querySelector(`[data-touch="${name}"]`);
      if (!el) return;
      let id = null;
      const off = (e) => { if (e.pointerId === id) { id = null; this.touch[name] = false; } };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        id = e.pointerId;
        this.touch[name] = true;
        capture(el, e);
      });
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
    };
    hold('handbrake');
    hold('item');
  }
}
