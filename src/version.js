// Version badge and update check. Deployed builds carry a version.json
// stamped by the Pages workflow; a local checkout has none, so everything
// here quietly does nothing.
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
  const current = await fetchVersion();
  if (!current) return;
  if (badge) badge.textContent = `v ${current}`;

  let found = false;
  const check = async () => {
    if (found || document.hidden) return;
    const latest = await fetchVersion();
    if (latest && latest !== current) {
      found = true;
      chip?.classList.remove('hidden');
    }
  };
  setInterval(check, POLL_MS);
  addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  chip?.addEventListener('click', () => location.reload());
}
