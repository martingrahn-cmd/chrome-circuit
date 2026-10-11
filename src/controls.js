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

// PlayStation's symbols, drawn rather than typed, so they sit dead centre
// whatever the font.
const SYMBOLS = {
  a: '<path d="M8.3 8.3l7.4 7.4M15.7 8.3l-7.4 7.4"/>',
  b: '<circle cx="12" cy="12" r="4.7"/>',
  x: '<rect x="7.7" y="7.7" width="8.6" height="8.6"/>',
  y: '<path d="M12 7l5 8.7H7z"/>',
};

/** A round button: an SVG, its letter centred on the capitals by geometry
 *  (half a cap height below the middle), not by a font's line metrics,
 *  which differ from one system font to the next. */
function round(cls, attrs, label, inner) {
  return `<svg class="pb ${cls}" ${attrs} viewBox="0 0 24 24" role="img" aria-label="${label}">${inner
    || `<text x="12" y="12" dy="0.36em" text-anchor="middle">${label}</text>`}</svg>`;
}

/** One button, drawn the way it looks on the pad. */
export function glyph(family, button) {
  const name = NAMES[family][button];
  if (['a', 'b', 'x', 'y'].includes(button)) {
    const inner = family === 'playstation' ? `<g class="pb-sym">${SYMBOLS[button]}</g>` : '';
    return round('pb--face', `data-fam="${family}" data-btn="${button}"`, name, inner);
  }
  const kind = button === 'start' || button === 'view' ? 'menu' : 'shoulder';
  return `<span class="pb pb--${kind}" data-fam="${family}" data-btn="${button}"><span>${name}</span></span>`;
}

const key = (k) => `<kbd>${k}</kbd>`;
const stick = (side = 'L') => round('pb--stick', '', side);
const dpad = round('pb--dpad', '', 'd-pad', '<path class="pb-dpad" d="M10 6h4v4h4v4h-4v4h-4v-4H6v-4h4z"/>');

/** The driving controls, as rows of [what, how] in HTML. */
export function controlRows(source, family = 'xbox', { fullscreen = true } = {}) {
  if (source === 'pad') {
    const g = (b) => glyph(family, b);
    return [
      ['Accelerate', `${g('rt')} or ${g('a')}`],
      ['Brake / reverse', g('lt')],
      ['Steer', `${stick()} or ${dpad}`],
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
