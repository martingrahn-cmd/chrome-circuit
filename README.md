# Chrome Circuit

An isometric arcade racer in the spirit of *Rock'n Roll Racing* and *Super Off Road*,
built from Kenney's CC0 3D kits. Plain ES modules and a vendored Three.js — no build
step, no dependencies to install.

Play it at **<https://martingrahn-cmd.github.io/chrome-circuit/>**, or serve the
checkout yourself:

```sh
python3 -m http.server 8000    # then browse to http://localhost:8000/
```

Opening the file directly with `file://` will not work: the game loads ES modules
and `.glb` models over `fetch`. `localhost` also counts as a secure origin, so the
service worker below runs against a local checkout too.

## Playing

| | Keyboard | Gamepad |
|---|---|---|
| Accelerate | `W` / `↑` | `RT` or `A` |
| Brake, reverse | `S` / `↓` | `LT` or d-pad down |
| Steer | `A` `D` / `←` `→` | left stick or d-pad |
| Use item | `Space` | `X` or `Y` |
| Handbrake | `Shift` | `RB` |
| Pause | `Esc` / `P` | `Start` |

Touch controls appear on phones and tablets. Held sideways, the circuit and car
pickers become a strip that scrolls across under a pinned header and footer, the
how-to and results spread into two columns, and the HUD loses its best-lap readout
so the minimap and the speedo do not meet. Held upright the pickers run in two
columns and the touch buttons shrink to fit.

### Installing it

The game is a progressive web app, so it installs to a home screen or a desktop
dock and runs full-screen with no browser furniture, landscape, offline.

- **Android / desktop Chrome, Edge** — an **Install** button appears in the main
  menu as soon as the browser offers one (there is also the address-bar install
  icon).
- **iOS / iPadOS** — Safari has no install prompt: *Share* → *Add to Home Screen*.

Installed or not, a service worker (`sw.js`) caches the game the first time you
play, so afterwards it starts with no network at all — the whole field, all five
circuits, everything. It keeps two caches on purpose: the code goes in one keyed
on the deployed build, and the Kenney models — 7 MB that never change — in
another that survives deploys, so an update re-downloads a few hundred KB rather
than the whole kit.

The update chip works the same as before but now hands over properly: it pulls
the new worker in, lets it take the caches, and only then reloads, so you land on
the new build instead of the cached old one. The version in the menu credits is
the build actually on screen, which after a deploy is not necessarily the one the
server has — that gap is what the chip is offering to close.

A checkout has no stamped build (the Pages workflow does the stamping), and then
the worker serves the code network-first: edit a file, reload, see the edit.

### Controllers

Any browser-standard gamepad is picked up as soon as you press something on it —
there is nothing to configure, and a notice tells you which pad connected. The
stick has a deadzone and a mild response curve, and the triggers are analog, so
part-throttle and trailing the brake into a corner both work.

The menus are fully navigable from the pad: d-pad or stick to move, `A` to choose,
`B` to go back, `Start` to confirm or to pause mid-race. Navigation is spatial
rather than a fixed list, so moving right across the car grid does what you expect.
The same movement keys work on the keyboard, and everything routes through real DOM
focus, so tabbing through the menus works too.

Pads with haptics rumble on the countdown lights, contact, barrier scrapes, taking a
rocket and lighting the turbo.

Choosing a circuit takes you straight to the car select, and choosing a car starts
the race — no walking down to a confirm button. The garage, reached from the main
menu, is browse-only.

You start last on a six-car grid every race. Podium on a circuit to unlock the next
one; two cars unlock the same way. Progress lives in `localStorage`.

Tuck in behind the car ahead and you pick up its slipstream — worth about 14% on
top speed, and the surest way past on a long straight. The HUD says when you have it.

Items come from the boxes on track: **Turbo** (a short overdose of speed), **Rocket**
(fires forward, leans toward whoever is ahead) and **Oil Drum** (dropped behind you).
Grass and dirt cost grip and top speed; barriers cost more.

## How it fits together

```
index.html            markup for the HUD and every menu screen
styles.css            all presentation
manifest.webmanifest  name, icons, colours and display mode for installing
sw.js                 service worker: offline play and the deploy hand-off
icons/                app icon, as SVG source and the PNGs the platforms want
src/
  main.js             boot, screen flow, frame loop, attract mode
  engine.js           renderer, orthographic isometric camera, lighting
  assets.js           GLB loading, one shared material per kit
  track.js            grid path -> racing line, ribbon road, scenery
  tracks.js           the five circuit definitions
  roster.js           the ten cars and their stats
  car.js              arcade vehicle physics and car-vs-car contact
  ai.js               AI drivers
  race.js             grid, countdown, laps, standings, effects
  items.js            pickups, rockets, dropped hazards
  fx.js               pooled particles and skid marks
  audio.js            synthesised engine note and sound effects
  hud.js              readouts and minimap
  input.js            keyboard, gamepad and touch
  thumbs.js           car and circuit previews for the menus
  progress.js         unlocks and best laps
  pwa.js              service-worker registration, updates, the install button
  version.js          the version badge and the update check
vendor/three/         Three.js r180 (module build) + GLTFLoader
assets/               the Kenney models actually used, by kit
```

### Circuits are authored as moves

A track is a closed loop of cardinal steps on a tile grid:

```js
{ start: [0, 0], moves: 'R14 D4 L4 D4 R4 D4 L14 U12', walls: true }
```

`track.js` turns that into a racing line of straights joined by circular arcs whose
radius is capped by half the shortest neighbouring straight — so chicanes stay tight
and long sweepers stay fast — and then extrudes the road itself as a ribbon along
that line, so the tarmac sweeps through the corners exactly where the cars do. On
walled circuits the armco is built from the same line the cars are clamped to. Everything else — lap counting, off-track detection, the AI's line
and the minimap — is measured against that one centre line.

Adding a circuit means adding an entry to `TRACKS`; the move string is validated by
having to close the loop.

### Which way is right

Kenney's cars face +Z with their front-*left* wheel on local +X, so local +X is the
car's left and a right-hand turn *lowers* the heading. Getting that backwards
inverts the steering for every human input while leaving the AI looking fine,
because an AI that steers toward a target is self-consistent either way.

### Racing room

Cars collide as capsules down their length rather than as one circle. A circle
big enough to cover a 2.6-long car is 2.7 wide, so two cars "touch" from two
car-widths apart and side-by-side racing becomes impossible. The capsule is 1.44
wide, and the drivable band is 0.8 of a tile — the width of the actual tarmac on
the Kenney road piece — which leaves room for six abreast. The AI holds a tighter
line than it used to and steers away from anyone alongside instead of squeezing
them off.

### Scenery placement

The camera looks down the `(-1, 0, -1)` ground direction, so a prop at cell `(x, z)`
can only ever hide the track cells at `(x-k, z-k)`. Each candidate cell gets a height
budget from how far the nearest such track cell is, and only props that fit under it
are eligible. Tall towers end up behind the circuit and low dressing in front of it.

### Performance

The whole track — road, barriers, buildings, trees — is merged into one mesh per kit,
and the effects layer is two pooled draw calls, so a full scene runs in roughly 20–45
draw calls.

## Credits

All 3D models by [Kenney](https://kenney.nl) under CC0: Car Kit, City Kit (Roads),
City Kit (Commercial), City Kit (Suburban) and Toy Car Kit. Three.js is MIT.
