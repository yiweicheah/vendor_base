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
