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

// The icons, from Kenney's Input Prompts (CC0, tools/input_prompts.py), by
// button. The standard mapping is by position, so Nintendo's bottom button,
// ‘a’ here, is the one printed B.
const ICONS = {
  xbox: {
    a: 'xbox_button_color_a', b: 'xbox_button_color_b', x: 'xbox_button_color_x', y: 'xbox_button_color_y',
    lb: 'xbox_lb', rb: 'xbox_rb', lt: 'xbox_lt', rt: 'xbox_rt',
    start: 'xbox_button_menu', view: 'xbox_button_view', stick: 'xbox_stick_l', dpad: 'xbox_dpad',
  },
  playstation: {
    a: 'playstation_button_color_cross', b: 'playstation_button_color_circle',
    x: 'playstation_button_color_square', y: 'playstation_button_color_triangle',
    lb: 'playstation_trigger_l1', rb: 'playstation_trigger_r1', lt: 'playstation_trigger_l2', rt: 'playstation_trigger_r2',
    start: 'playstation4_button_options', view: 'playstation5_button_create',
    stick: 'playstation_stick_l', dpad: 'playstation_dpad',
  },
  nintendo: {
    a: 'switch_button_b', b: 'switch_button_a', x: 'switch_button_y', y: 'switch_button_x',
    lb: 'switch_button_l', rb: 'switch_button_r', lt: 'switch_button_zl', rt: 'switch_button_zr',
    start: 'switch_button_plus', view: 'switch_button_minus', stick: 'switch_stick_l', dpad: 'switch_dpad',
  },
};
const KEYS = {
  W: 'keyboard_w', A: 'keyboard_a', S: 'keyboard_s', D: 'keyboard_d',
  '↑': 'keyboard_arrow_up', '↓': 'keyboard_arrow_down', '←': 'keyboard_arrow_left', '→': 'keyboard_arrow_right',
  Shift: 'keyboard_shift', Space: 'keyboard_space', Esc: 'keyboard_escape', P: 'keyboard_p', F: 'keyboard_f',
};

const icon = (file, label, cls = '') => `<img class="pb${cls}" src="assets/prompts/${file}.svg" alt="${label}" title="${label}" draggable="false">`;

/** One button, as it looks on the pad. */
export function glyph(family, button) {
  // PlayStation's small centre buttons are slim in a square icon: bigger.
  const wide = family === 'playstation' && (button === 'start' || button === 'view') ? ' pb--wide' : '';
  return icon(ICONS[family][button], NAMES[family][button] || { stick: 'Left stick', dpad: 'D-pad' }[button], wide);
}

// Shift and Space are wide keys in a square icon: drawn bigger to read.
const key = (k) => icon(KEYS[k], k, k === 'Shift' || k === 'Space' ? ' pb--wide' : '');

/** The driving controls, as rows of [what, how] in HTML. */
export function controlRows(source, family = 'xbox', { fullscreen = true } = {}) {
  if (source === 'pad') {
    const g = (b) => glyph(family, b);
    return [
      ['Accelerate', `${g('rt')} or ${g('a')}`],
      ['Brake / reverse', g('lt')],
      ['Steer', `${g('stick')} or ${g('dpad')}`],
      ['Drift', `${g('rb')} — hold into a corner, let go on the way out`],
      ['Use item', `${g('x')} or ${g('y')}`],
      ['Pause', g('start')],
      ...(fullscreen ? [['Full screen', g('view')]] : []),
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
export function controlList(source, family, opts) {
  return controlRows(source, family, opts).map(([what, how]) => `<dt>${what}</dt><dd>${how}</dd>`).join('');
}

/** The menus' button bar: what the face buttons do here. */
export function menuHints(family, { back = true, fullscreen = false } = {}) {
  return `<span>${glyph(family, 'a')} Select</span>${back ? `<span>${glyph(family, 'b')} Back</span>` : ''}`
    + (fullscreen ? `<span>${glyph(family, 'view')} Full screen</span>` : '');
}
