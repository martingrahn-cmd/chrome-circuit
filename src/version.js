// Version badge and update check. Deployed builds carry a version.json
// stamped by the Pages workflow; a local checkout has none, so everything
// here quietly does nothing.
import { applyUpdate, runningBuild } from './pwa.js';

const POLL_MS = 5 * 60 * 1000;

async function fetchVersion() {
  try {
    const res = await fetch('./version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

/** Show the running version in `badge`; reveal `chip` when a newer deploy
 *  appears (checked every few minutes and when the tab regains focus). */
export async function watchVersion(badge, chip) {
  const deployed = await fetchVersion();
  if (!deployed) return;
  // Installed, the game runs from the service worker's cache, so the build on
  // screen can already be behind the one on the server — offer the update at
  // once rather than waiting for the next deploy.
  const current = (await runningBuild()) || deployed;
  if (badge) badge.textContent = `v ${current}`;

  let found = false;
  const show = () => { found = true; chip?.classList.remove('hidden'); };
  if (deployed !== current) show();

  const check = async () => {
    if (found || document.hidden) return;
    const latest = await fetchVersion();
    if (latest && latest !== current) show();
  };
  setInterval(check, POLL_MS);
  addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  // Installed, the game is served from the service worker's cache, so a plain
  // reload would land right back on the build we are trying to leave.
  chip?.addEventListener('click', async () => {
    chip.disabled = true;
    await applyUpdate();
    location.reload();
  });
}
