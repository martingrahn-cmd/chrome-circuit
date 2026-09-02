/* Service worker: makes Chrome Circuit installable and playable offline.
 *
 * Two caches with deliberately different lifetimes:
 *
 *   shell-<build>   the game itself — markup, CSS, the ES modules, Three.js,
 *                   icons. Keyed on the deployed build, so every deploy starts
 *                   from a clean copy and the old one is dropped on activate.
 *   assets          the Kenney GLB kits and their colormaps. Those bytes never
 *                   change, so they outlive every deploy: an update costs a few
 *                   hundred KB of code rather than 7 MB of models.
 *
 * A local checkout has no stamped build — the Pages workflow does the stamping —
 * and then the shell is served network-first, so editing a file and reloading
 * shows the edit instead of last week's cache.
 */
const BUILD = '__BUILD__';
const DEV = BUILD.startsWith('__');

const SHELL = `chrome-circuit-shell-${BUILD}`;
const ASSETS = 'chrome-circuit-assets';
const KEEP = [SHELL, ASSETS];

/* Everything needed to boot with no network. Models are not in here: they are
 * cached as the game loads them (and swept up by the `warm` message below), so
 * installing stays a fast ~1 MB. A module missing from this list still works —
 * it is cached the first time it is fetched — it just is not there on a cold
 * offline start, so new modules belong here. */
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './src/ai.js',
  './src/assets.js',
  './src/audio.js',
  './src/car.js',
  './src/engine.js',
  './src/fx.js',
  './src/hud.js',
  './src/input.js',
  './src/items.js',
  './src/main.js',
  './src/progress.js',
  './src/pwa.js',
  './src/race.js',
  './src/roster.js',
  './src/thumbs.js',
  './src/track.js',
  './src/tracks.js',
  './src/version.js',
  './vendor/three/three.module.min.js',
  './vendor/three/three.core.min.js',
  './vendor/three/loaders/GLTFLoader.js',
  './vendor/three/utils/BufferGeometryUtils.js',
];

const ASSET_ROOT = new URL('./assets/', self.location).pathname;
const VERSION_URL = new URL('./version.json', self.location).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('chrome-circuit-') && !KEEP.includes(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // The update check must see the real deploy, so it goes to the network and
  // only falls back to the cache when there isn't one (offline shows a version
  // badge rather than a blank).
  if (url.pathname === VERSION_URL) { event.respondWith(networkFirst(req, SHELL, './version.json')); return; }

  if (url.pathname.startsWith(ASSET_ROOT)) { event.respondWith(cacheFirst(req, ASSETS)); return; }

  if (req.mode === 'navigate') { event.respondWith(navigation(req)); return; }

  event.respondWith(DEV ? networkFirst(req, SHELL) : cacheFirst(req, SHELL));
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'skip-waiting') self.skipWaiting();
  else if (data.type === 'warm' && Array.isArray(data.urls)) event.waitUntil(warm(data.urls));
  // Which build is on screen. Cached, that is this worker's shell rather than
  // whatever version.json says the server has now — the difference between the
  // two is exactly what the update chip is for. Unstamped, the shell comes off
  // the network, so there is no separate answer to give.
  else if (data.type === 'build') event.ports[0]?.postMessage({ build: DEV ? null : BUILD });
});

async function navigation(req) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match('./index.html');
  if (cached && !DEV) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put('./index.html', res.clone());
    return res;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}

async function networkFirst(req, name, key) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key || req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await cache.match(key || req);
    if (hit) return hit;
    throw err;
  }
}

/** Cache the models the game just loaded. On a first visit most of them are
 *  fetched before this worker controls the page, so nothing else would put
 *  them in the cache — and then the game would not run offline. */
async function warm(urls) {
  const cache = await caches.open(ASSETS);
  for (const url of urls) {
    try {
      if (await cache.match(url)) continue;
      const res = await fetch(url);
      if (res.ok) await cache.put(url, res);
    } catch { /* a model that will not load offline is not worth failing over */ }
  }
}
