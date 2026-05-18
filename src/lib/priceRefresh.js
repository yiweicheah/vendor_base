import { getCachedPrices, upsertCachedPrices, claimStaleCards } from './db';
import { getCardDetail, extractPrice } from './pokewallet';

const BATCH_SIZE      = 10;
const BATCH_DELAY_MS  = 150;
const DAILY_MS        = 24 * 60 * 60 * 1000;
const DELAY_BUFFER_MS =  2 * 60 * 60 * 1000; // absorbs API update delays

let lastPriceFetchedAt = null;
export function getLastPriceFetched() { return lastPriceFetchedAt; }

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isStale(entry) {
  if (!entry || !entry.priceUpdatedAt) return true;
  return Date.now() > entry.priceUpdatedAt.getTime() + DAILY_MS + DELAY_BUFFER_MS;
}

/**
 * Fetch current market prices for a set of card IDs using a Supabase-backed
 * shared cache. Staleness is anchored to the API's own `updated_at` timestamp
 * (+ 26h buffer), so we never over-fetch and never miss a daily price update.
 *
 * Uses an atomic DB claim to prevent the thundering herd: at most one session
 * fetches any given card at a time. Other sessions display the existing cached
 * price until the winner writes the fresh value.
 *
 * forceRefresh=true bypasses staleness checks (used by the manual refresh button).
 *
 * Returns a Map<cardExternalId, { priceMyr, priceSource, priceUpdatedAt, fetchedAt }>.
 */
export async function refreshStaleCardPrices(cardIds, forceRefresh = false) {
  if (!cardIds.length) return new Map();

  const cached = await getCachedPrices(cardIds);

  const staleIds = cardIds.filter((id) => forceRefresh || isStale(cached.get(id)));
  if (!staleIds.length) return cached;

  // Atomically claim cards — only this session will fetch what it claims
  const claimed = await claimStaleCards(staleIds, forceRefresh);
  if (!claimed.length) return cached;

  const fresh = [];
  for (let i = 0; i < claimed.length; i += BATCH_SIZE) {
    const batch = claimed.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((id) => getCardDetail(id)));
    for (let j = 0; j < batch.length; j++) {
      const card = results[j];
      if (!card) continue;
      const price = extractPrice(card);
      if (!price) continue;
      const now = new Date().toISOString();
      const entry = {
        card_external_id: batch[j],
        price_myr:        price.myr,
        price_source:     price.source,
        price_updated_at: price.updatedAt ?? null,
        fetched_at:       now,
        locked_until:     null,
      };
      fresh.push(entry);
      cached.set(batch[j], {
        priceMyr:       price.myr,
        priceSource:    price.source,
        priceUpdatedAt: price.updatedAt ? new Date(price.updatedAt) : null,
        fetchedAt:      new Date(now),
      });
    }
    if (i + BATCH_SIZE < claimed.length) await sleep(BATCH_DELAY_MS);
  }

  if (fresh.length > 0) await upsertCachedPrices(fresh);

  for (const entry of cached.values()) {
    if (entry.fetchedAt && (!lastPriceFetchedAt || entry.fetchedAt > lastPriceFetchedAt)) {
      lastPriceFetchedAt = entry.fetchedAt;
    }
  }
  window.dispatchEvent(new CustomEvent('pricerefreshed'));

  return cached;
}
