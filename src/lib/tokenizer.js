/**
 * Split a search query into name tokens, a card number (localId),
 * and optionally a set total (denominator in N/M format).
 *
 * "charizard"       → { nameTokens: ["charizard"], localId: null,  setTotal: null, setTotalRaw: null }
 * "276"             → { nameTokens: [],             localId: "276", setTotal: null, setTotalRaw: null }
 * "080/080"         → { nameTokens: [],             localId: "080", setTotal: 80,   setTotalRaw: "080" }
 * "pikachu 276/217" → { nameTokens: ["pikachu"],    localId: "276", setTotal: 217,  setTotalRaw: "217" }
 *
 * setTotal    (integer) — used for client-side filtering; parseInt strips leading zeros intentionally.
 * setTotalRaw (string)  — used for building the API query string; preserves leading zeros exactly.
 */
export function tokenize(query) {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const nameTokens = [];
  let localId     = null;
  let setTotal    = null;
  let setTotalRaw = null;

  for (const token of tokens) {
    const slashMatch = token.match(/^(\d+)\/(\d+)$/);
    if (slashMatch) {
      localId     = slashMatch[1];
      setTotalRaw = slashMatch[2];
      setTotal    = parseInt(slashMatch[2], 10);
      continue;
    }
    if (/^\d+$/.test(token)) {
      localId = token;
      continue;
    }
    nameTokens.push(token);
  }

  return { nameTokens, localId, setTotal, setTotalRaw };
}

/**
 * Build the q= string for PokéWallet.
 * Uses setTotalRaw (not the integer) to preserve leading zeros
 * e.g. "080/080" → q=080/080, not q=080/80.
 */
export function buildQuery({ nameTokens, localId, setTotalRaw }) {
  const parts = [...nameTokens];
  if (localId != null) {
    parts.push(setTotalRaw != null ? `${localId}/${setTotalRaw}` : localId);
  }
  return parts.join(' ');
}

/**
 * Minimum viable query: 2 non-whitespace characters.
 */
export function isQueryTooShort(raw) {
  return raw.replace(/\s/g, '').length < 2;
}

/**
 * Returns the opposite zero-padding form of a number string, or null if no
 * alternate exists. Only handles all-digit strings (skips tg06, sv1, etc.).
 * Pads/strips to 3 digits: "082" → "82", "82" → "082", "100" → null.
 */
function altNumber(s) {
  const n = parseInt(s, 10);
  const stripped = n.toString();
  const padded = stripped.padStart(3, '0');
  if (s === stripped) return padded !== s ? padded : null;
  return stripped;
}

/**
 * Returns an alternate query string for number-only searches, covering both
 * zero-padded and unpadded card number formats (e.g. "082/090" ↔ "82/90").
 * Returns null if no alternate applies (alphanumeric numbers, no leading zeros,
 * or padding wouldn't change the string).
 */
export function buildAlternateNumberQuery({ localId, setTotalRaw }) {
  if (!localId || !/^\d+$/.test(localId)) return null;
  const altLocalId = altNumber(localId);
  if (!altLocalId) return null;
  if (setTotalRaw) {
    if (!/^\d+$/.test(setTotalRaw)) return null;
    const altSet = altNumber(setTotalRaw);
    return altSet ? `${altLocalId}/${altSet}` : null;
  }
  return altLocalId;
}
