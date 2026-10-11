// What the controls are called on whatever is in the player's hands: the
// pad's own button names (Xbox, PlayStation or Nintendo), the keyboard's keys,
// or the phone's thumbs. The pause screen, How to play, the HUD and the menus'
// button bar all show the one last used.

/** Whose pad, from the id the browser gives it. */
export function padFamily(id = '') {
  const s = id.toLowerCase();
  // Xbox first: its pads are "Xbox Wireless Controller", and a bare
  // "Wireless Controller" is how some systems name a DualShock.
  if (/045e|xbox|xinput/.test(s)) return 'xbox';
  if (/054c|playstation|dualshock|dualsense|wireless controller/.test(s)) return 'playstation';
  if (/057e|nintendo|pro controller|joy-con/.test(s)) return 'nintendo';
  return 'xbox';
}

// The names on the buttons, by the standard mapping's position: `a` is the
// bottom face button, `b` the right, `x` the left and `y` the top.
const NAMES = {
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', start: 'Menu', view: 'View' },
  playstation: { a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', start: 'Options', view: 'Create' },
  nintendo: { a: 'B', b: 'A', x: 'Y', y: 'X', lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR', start: '+', view: '−' },
};

export const buttonName = (family, button) => NAMES[family][button];

/** One button, drawn the way it looks on the pad. */
export function glyph(family, button) {
  const face = ['a', 'b', 'x', 'y'].includes(button);
  const kind = face ? 'face' : button === 'start' || button === 'view' ? 'menu' : 'shoulder';
  return `<span class="pb pb--${kind}" data-fam="${family}" data-btn="${button}"><span>${NAMES[family][button]}</span></span>`;
}

const key = (k) => `<kbd>${k}</kbd>`;
const stick = (side = 'L') => `<span class="pb pb--stick"><span>${side}</span></span>`;
const dpad = '<span class="pb pb--dpad" aria-label="d-pad"><span>✚</span></span>';

/** The driving controls, as rows of [what, how] in HTML. */
export function controlRows(source, family = 'xbox') {
  if (source === 'pad') {
    const g = (b) => glyph(family, b);
    return [
      ['Accelerate', `${g('rt')} or ${g('a')}`],
      ['Brake / reverse', g('lt')],
      ['Steer', `${stick()} or ${dpad}`],
      ['Drift', `${g('rb')} — hold into a corner, let go on the way out`],
      ['Use item', `${g('x')} or ${g('y')}`],
      ['Pause', g('start')],
      ['Full screen', g('view')],
    ];
  }
  if (source === 'touch') {
    return [
      ['Steer', 'Slide your left thumb — further turns harder'],
      ['Drift', 'Hold anywhere on the right, let go for the kick'],
      ['Use item', '<b>★</b>, bottom left'],
      ['Pause', '<b>❚❚</b>, top centre'],
    ];
  }
  return [
    ['Accelerate / brake', `${key('W')} ${key('S')} or ${key('↑')} ${key('↓')}`],
    ['Steer', `${key('A')} ${key('D')} or ${key('←')} ${key('→')}`],
    ['Drift', `${key('Shift')} — hold into a corner, let go on the way out`],
    ['Use item', key('Space')],
    ['Pause', `${key('Esc')} or ${key('P')}`],
  ];
}

/** The controls as a definition list's inner HTML. */
export function controlList(source, family) {
  return controlRows(source, family).map(([what, how]) => `<dt>${what}</dt><dd>${how}</dd>`).join('');
}

/** The menus' button bar: what the face buttons do here. */
export function menuHints(family, { back = true, fullscreen = false } = {}) {
  return `<span>${glyph(family, 'a')} Select</span>${back ? `<span>${glyph(family, 'b')} Back</span>` : ''}`
    + (fullscreen ? `<span>${glyph(family, 'view')} Full screen</span>` : '');
}
