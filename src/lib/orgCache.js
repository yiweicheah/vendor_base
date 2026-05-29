// Stale-while-revalidate cache for the heavy per-org aggregates (metrics,
// eventBreakdown, monthlyPL, stock). Lets the UI hydrate instantly on boot
// or org switch using the last-known values, while fresh data is re-fetched
// in the background. Bump CACHE_VERSION when the cached shape changes.

const CACHE_VERSION = 1;
const KEY = (orgId) => `orgCache_v${CACHE_VERSION}_${orgId}`;

export function readOrgCache(orgId) {
  if (!orgId) return null;
  try {
    const raw = localStorage.getItem(KEY(orgId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeOrgCache(orgId, patch) {
  if (!orgId) return;
  try {
    const current = readOrgCache(orgId) ?? {};
    localStorage.setItem(KEY(orgId), JSON.stringify({ ...current, ...patch }));
  } catch {
    // quota exceeded / private browsing — silently drop
  }
}
