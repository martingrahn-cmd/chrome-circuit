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
| Handbrake (drift) | `Shift` | `RB` |
| Pause | `Esc` / `P` | `Start` |

On a phone the car drives itself and there are two invisible halves: slide a
thumb anywhere on the left to steer — the distance from where it landed is the
input, analog, with the same curve as a pad stick — and hold anywhere on the
right to drift, letting go for the kick. One real button, **★**, fires the item.
It sits on the left, just above the item it fires, so the right thumb can hold a
drift; a committed drift keeps its line while the left thumb leaves the steering
to tap it. Touching the right side as the lights go green is the rocket start. A
small pause sits at the top. Held sideways, the circuit and car
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

### Worlds

The circuits come in worlds, picked from a switch at the top of the circuit screen:

- **Grand Tour** — the first five: city streets, the harbour, Sakura Hills, Neon
  Speedway and the Pinecrest forest rally.
- **Alpine Winter** — Frostvale Village, Glacier Pass and Summit Run. Roads that
  climb, deep snow off the tarmac, ice on the high stretches and snow falling the
  whole time.

A world opens with a podium on the last circuit of the one before it, and the
unlock card says so.

Height on a climbing circuit is felt as well as seen: a climb takes speed off and a
descent gives it back, and the car pitches with the road. Off the tarmac in the Alps
is deep snow — slower than dirt, about as slippery. Ice keeps full speed but has a
third of the grip, so a car goes on the way it was going; the rivals see it coming
and ease off for the bends on it.

### Championship

Every circuit of one world in turn, against the same five rivals, with points for every
place: 10, 7, 5, 3, 2, 1. Pick a difficulty and a car, and the table after each
round shows every driver's finish so far. Ties go to more wins, then more
seconds, then to whoever was ahead in the latest round. A championship in
progress is saved with the rest of your progress, so the menu offers to continue
it after a reload; quitting mid-round leaves that round to race again, and
abandoning one takes a second press. Your best final place is kept per
world and difficulty. A new championship offers the furthest world you have
reached. Championship rounds still set best laps and unlock circuits and cars
the same way single races do.

### Time trial and medals

**Time trial** puts you alone on any circuit: no rivals, no item boxes. Your first
complete flying lap becomes a ghost, a see-through glowing car. From then on you
race it, and every lap that beats it becomes the new ghost. The position box turns
into a **delta**: how far ahead (green) or behind (red) you are against the ghost at
the same point of the lap. Under it is the next medal still to win. A new best is
saved the moment it is set, ghost and all, so the next time trial there starts
against it.

Every circuit has three medals:

- **Gold** is the best flying lap a near-flawless driver (the AI at skill 0.95,
  alone, drifting the tight corners) set in the Comet, the balanced car, rounded up
  to a tenth.
- **Silver** is 6% slower than gold.
- **Bronze** is 14% slower than gold.

A faster car makes a medal easier and a slower one harder. Medals show on the circuit
cards in every mode. A better one is called out on the spot and gets the card on the
results screen. A ghost is stored as fifteen samples a second of time, position,
heading and distance round the lap, about 11 KB a lap.

### Career and single race

**Career** is the way through the game: podium on a circuit to unlock the next one,
and two cars unlock the same way. **Single race** opens every circuit in every world
from the start. A single race on a circuit the career has reached counts in full. On
one it has not reached yet, it keeps your best lap but opens nothing — not the next
circuit, not a car — and the car screen says so before you start. Cars in a single
race are the ones you have unlocked.

You start last on a six-car grid every race. Progress lives in `localStorage`, and so does the
difficulty, which starts at Rookie.

The difficulty is picked from four coloured buttons at the top of the circuit screen
(and the championship setup), each with a one-line promise. The level stays in sight
afterwards: it sits beside your position in the HUD for the whole race and under the
title on the results screen.

Rookie is meant to be a race a first-timer can win — and one a good driver still has
to race for. The levers all fade as the difficulty climbs: the rivals run slower (78%
pace at Rookie, 94% at Pro, 98.5% at Ace, full at Legend), ease off harder when the
player drops back, and pick their pace back up — never past their honest Legend speed
— when the player leads and pulls away, so a win is by seconds rather than a lap; a
steering assist blends the player's input toward the clean line out near the edge
of the road, so a late or shaky input is nudged back before a wheel drops (0.7 at
Rookie, 0.3 Pro, 0.1 Ace, none at Legend); and the run-off punishes the player
less (Rookie fully, Pro a third). The item boxes lean the same way: a backmarker
draws turbos half the time and the leader mostly draws things to defend with, in
full at Rookie, 70% at Pro, a third at Ace and not at all at Legend, where every box
deals even odds. Legend's rivals are also a clear step sharper than Ace's rather
than one more even rung. A simulated beginner — road followed by eye, 0.3 s
reaction lag, shaky hands, never lifting — went from last every race to P1–P5 at
Rookie. Pro is a fair fight, not a formality: a strong stand-in driver with no
assist won 58% of its Pro races before the levers were tightened and 40% after,
and about one in five at Ace and Legend.

The rivals hold an item until it is worth using — a turbo for a straight, a
rocket for a car ahead, a drum for a car close behind — and steer round oil drums
in their path. Drums last twelve seconds and no more than six are down at once.

Tuck in behind the car ahead and you pick up its slipstream — worth about 14% on
top speed, and the surest way past on a long straight. The HUD says when you have it.

The handbrake is for drifting, not stopping. Hold it into a corner with the wheel
turned and the car commits to a slide that way. From then on, steering only makes
the arc tighter or wider, so a slipping thumb or a tap on a key cannot swap ends.
The slide keeps most of its speed. While it lasts on the road, sparks at the back
wheels turn blue (0.6 s), then orange (1.4 s). Let go and the slide pays out a
kick of speed: half a second for blue, a second for orange. Snow, grass or dirt
drains the charge.

There is no timing window on the release, which no thumb on a phone could hit:
how long the car stayed sideways is what counts. Drifting the tight corners well
is worth three to five percent a lap. Rivals drift too, which is one more
difficulty lever: none of them at Rookie, half at Pro, most at Ace, all at Legend.
They slide only real corners and let go at the exit.
A plain handbrake with the wheel straight is still a brake.

**Rocket start:** put the gas down in the instant the lights go green (on a
phone, touch the right side) and you leave on a turbo. Do it while the lights are
still red and hold it, and the wheels spin for a moment instead.

**Air.** A car leaves the ground in two ways. Over a crest, the road can bend away
beneath it faster than gravity (15 units/s², light, for hang time) can pull it down.
Off the lip of a ramp, the ground simply drops away. In the air there is no grip or
throttle and only a little steering, enough to line up the landing. The car pitches
with its flight. The ring under the player's car stays on the ground, so the gap to
it shows the height. Landing squats the body on its springs, kicks up dust and
thumps. Six-tenths of a second in the air or more is **BIG AIR** and pays out a kick,
as a drift does. On the ground, a car climbs only as fast as the slope under it, so
sliding onto a ramp from the side does not fire it into the sky.

In the Alps, crests lift for about 0.4 s. Glacier Pass has a full-width ski jump
halfway down the long descent, with a second of hang time. Frostvale and Summit Run
have one-lane ramps, worth 0.7–0.9 s.

**In the moment.** A place gained and held for a moment calls **OVERTAKE!** with the
new position. A short-lived swap side by side does not. Shaving past a car, a few
units faster than it, without touching, is a **CLOSE CALL** and a short kick. Each
rival counts once every few seconds. A small red marker floats over the car you are
chasing; when you lead, an orange one marks whoever is closest behind.

Items come from the boxes on track: **Turbo** (a short overdose of speed), **Rocket**
(fires forward, leans toward whoever is ahead) and **Oil Drum** (dropped behind you —
built in code, since none of the kits has a barrel; the spill around it is exactly as
wide as the hazard reaches).
The slot shows an icon for what you hold and pops when a box lands in it; drive
through a box with the slot already full and the box hops, the slot rattles and
you hear a flat "nope" — you can only carry one.

Crossing the line hands your car to the AI for the cool-down, so the celebration
plays out on the road rather than in a building.
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
  terrain.js          ground with height in it, for circuits that climb
  tracks.js           the worlds and their circuit definitions
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
  progress.js         unlocks, best laps, the championship in progress
  champ.js            championship points, standings and save validation
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

A circuit that climbs adds one height per move — where that leg ends:

```js
{ moves: 'R14 U3 L10 U3 R9 U3 L13 D9', heights: [0, 4, 7, 11, 14, 17, 16, 0],
  ice: [[0.6, 0.7]] }
```

Heights run linearly along each leg, carry over onto the racing line, and are
smoothed so crests and dips round off. `ice` lists stretches of the lap, as fractions
from the start line. Keep the start straight level; the grid stands on it.

Crests and jump ramps go in the same way:

```js
crests: [{ at: 0.72, height: 0.55, length: 13 }],
jumps: [{ at: 0.83, width: 'full', length: 9, height: 1.6 }],   // or lane: -1..1, width: share of the road
```

A crest is a smooth hump added to the road after the smoothing, so it stays sharp
enough to lift a car taken flat out. A ramp is a striped wedge on the road with an
orange pole either side of its foot. It can span the whole road, so everyone flies,
or one lane, so it is a choice. Item boxes stay off both.

### Ground with height in it

`terrain.js` builds the ground for a climbing circuit as one grid of heights. It is
flat across the road at the road's own height, out past the track limit, so a car's
height can come straight off the centre line. Beyond that, every road is a shelf cut
into a hillside that rises away from the camera: the ground climbs behind each road
and falls away in front of it. From this camera that is what makes height legible —
you see the bank above each road and the drop below it. Where two legs pass at
different heights, the slope between them comes from both, softly weighted toward
the nearer. Further out, mountains rise.

Snow lies on the level and rock shows where it is steep. The snow is grey-green down
in the valley and bright up top, so altitude reads as colour too. Trees stop at a
tree line, buildings get level footing dug into the slope, and the terrain casts
shadows onto the road below.

The camera looks down at 1.35 rise per unit of run, so ground between a car and the
camera may only rise that steeply before it hides the car. The last pass cuts the
grid down to that wherever a road lies behind it. Camera rays run along the grid's
diagonal, so one sweep in that order does it.

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
On a climbing circuit the budget also counts how much higher or lower that road sits.

Every prop has a job. Street circuits get a row of lamps at even spacing along the
camera-far side and a warning sign on the outside before each corner that asks you
to brake; rally roads get a fence along the straights and barriers round the outside
of the corners. The traffic lights live on the start gantry, where five of them fill
red through the countdown and go green at the start. Buildings stand on paved plots,
sometimes with a dumpster round the side, and only things that make sense on their
own — trees, and planters in town — stand in the open. Every corner has red-and-white
kerbs, the grid has painted slots, and a grandstand full of spectators faces the
start straight from the far side, where it frames the grid instead of hiding it.

### Performance

The whole track — road, barriers, buildings, trees — is merged into one mesh per kit,
and the effects layer is two pooled draw calls, so a full scene runs in roughly 20–45
draw calls.

## Credits

All 3D models by [Kenney](https://kenney.nl) under CC0: Car Kit, City Kit (Roads),
City Kit (Commercial), City Kit (Suburban), Toy Car Kit and Holiday Kit. The log
cabins in the Alps are assembled from the Holiday Kit's wall and roof pieces. Three.js is MIT.
