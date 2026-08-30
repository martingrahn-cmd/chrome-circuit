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
    this.touch = { throttle: 0, steer: 0, item: false };
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
    throttle += this.touch.throttle;
    if (this.touch.item) item = true;

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

  /** Wire the on-screen pad (mobile). Each button keeps its own held state
   *  and the shared axes are derived from all of them, so releasing one
   *  button never cancels the opposing button still under another finger. */
  bindTouch(root) {
    const held = { left: false, right: false, gas: false, brake: false, item: false };
    const apply = () => {
      this.touch.steer = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      this.touch.throttle = (held.gas ? 1 : 0) - (held.brake ? 1 : 0);
      this.touch.item = held.item;
    };
    for (const name of Object.keys(held)) {
      const el = root.querySelector(`[data-touch="${name}"]`);
      if (!el) continue;
      const set = (v) => (e) => { e.preventDefault(); held[name] = v; apply(); };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointercancel', set(false));
      el.addEventListener('pointerleave', set(false));
    }
  }
}
