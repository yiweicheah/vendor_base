/**
 * Returns true if the given Firebase UID matches the configured superuser UID(s).
 * Set VITE_SUPERUSER_UID in .env (comma-separated for multiple).
 */
export function isSuperuserUid(uid) {
  const configured = import.meta.env.VITE_SUPERUSER_UID?.trim();
  if (!configured) return false;
  return configured.split(',').map((s) => s.trim()).includes(uid);
}
