// Progressive-web-app plumbing: registering the service worker, handing a
// freshly deployed build over to it, and the install button.
//
// All of it degrades to nothing: `serviceWorker` is absent over plain http and
// `beforeinstallprompt` never fires on iOS (there you install from the browser's
// share menu), and in both cases the game runs exactly as it always did.

const SW_URL = new URL('../sw.js', import.meta.url);

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // The worker lives at the site root, so its default scope already covers the
  // whole game.
  navigator.serviceWorker.register(SW_URL)
    .catch((err) => console.warn('service worker not registered', err));
}

/** Ask the worker to cache models the game has already loaded. On a first
 *  visit most of them are fetched before the worker controls the page. */
export function cacheAssets(urls) {
  if (!('serviceWorker' in navigator) || !urls.length) return;
  navigator.serviceWorker.ready
    .then((reg) => reg.active?.postMessage({ type: 'warm', urls }))
    .catch(() => {});
}

/** Swap onto a newly deployed build: pull the new worker in and let it take
 *  over the caches, so the reload that follows serves the new game and not the
 *  one in the old cache. Gives up quietly after a few seconds — reloading onto
 *  the old build beats a button that does nothing. */
export async function applyUpdate() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
  if (!reg) return;
  await reg.update().catch(() => {});
  const incoming = reg.waiting || reg.installing;
  if (!incoming) return;

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 4000);
    const done = () => { clearTimeout(timer); resolve(); };
    navigator.serviceWorker.addEventListener('controllerchange', done, { once: true });
    // Only a worker that finished installing can be told to take over, so ask
    // again every time this one changes state.
    const promote = () => reg.waiting?.postMessage({ type: 'skip-waiting' });
    incoming.addEventListener('statechange', promote);
    promote();
  });
}

/** The build the page is actually running, which after a deploy is not the
 *  build the server has: the shell comes out of the worker's cache until the
 *  update is applied. Null when no worker is serving us. */
export async function runningBuild() {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1500);
    channel.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data?.build ?? null); };
    worker.postMessage({ type: 'build' }, [channel.port2]);
  });
}

let deferredPrompt = null;
let installButton = null;

/** Reveal `button` once the browser says the game is installable. */
export function watchInstall(button) {
  installButton = button;
  if (!button) return;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    button.classList.remove('hidden');
  });
  addEventListener('appinstalled', () => {
    deferredPrompt = null;
    button.classList.add('hidden');
  });
}

export async function promptInstall() {
  if (!deferredPrompt) return;
  const prompt = deferredPrompt;
  deferredPrompt = null;
  // A prompt can only be shown once; the button has nothing left to do.
  installButton?.classList.add('hidden');
  prompt.prompt();
  await prompt.userChoice.catch(() => {});
}
