import { getRates } from './exchangeRates';

const BASE = 'https://api.pokewallet.io';
const KEY = import.meta.env.DEV
  ? import.meta.env.VITE_POKEWALLET_API_DEV
  : import.meta.env.VITE_POKEWALLET_API;
const headers = { 'X-API-Key': KEY };

// ─── Search ───────────────────────────────────────────────────────────────────

export async function searchCards({ query, page = 1, signal }) {
  const url = `${BASE}/search?q=${encodeURIComponent(query)}&page=${page}&limit=20`;
  const res = await fetch(url, { headers, signal });

  if (res.status === 429) {
    const err = Object.assign(new Error('Rate limit reached'), { code: 'RATE_LIMIT' });
    throw err;
  }
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
  // Returns: { query, results: [...], pagination: { page, limit, total, total_pages } }
}

// ─── Card detail ──────────────────────────────────────────────────────────────

export async function getCardDetail(cardId, signal) {
  const res = await fetch(`${BASE}/cards/${cardId}`, { headers, signal });
  if (!res.ok) return null;
  return res.json();
}

// ─── Images ───────────────────────────────────────────────────────────────────

export function getTcgplayerImageUrl(tcgplayerUrl) {
  const productId = tcgplayerUrl?.split('/product/')[1]?.split('/')[0];
  if (!productId) return null;
  return `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_400w.jpg`;
}

const imageCache = new Map();

export async function getCardImage(card) {
  // TCGPlayer cards — free CDN, no API call needed
  if (card.tcgplayer?.url) {
    return { url: getTcgplayerImageUrl(card.tcgplayer.url) };
  }

  // CardMarket-only — fetch blob from PokéWallet (costs rate limit)
  const cacheKey = card.id;
  if (imageCache.has(cacheKey)) {
    return { url: imageCache.get(cacheKey) };
  }

  try {
    const res = await fetch(`${BASE}/images/${card.id}?size=low`, { headers });
    if (!res.ok) return { url: null };
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    imageCache.set(cacheKey, objectUrl);
    return { url: objectUrl };
  } catch {
    return { url: null };
  }
}

// ─── Pricing extraction ───────────────────────────────────────────────────────

const TCG_PRIORITY = ['Holofoil', 'Normal', 'Reverse Holofoil'];
const CM_PRIORITY  = ['holo', 'normal'];

export function extractPrice(card) {
  const { USD_TO_MYR, EUR_TO_MYR } = getRates();

  // 1. TCGPlayer
  const tcgPrices = card.tcgplayer?.prices;
  if (tcgPrices?.length) {
    for (const variant of TCG_PRIORITY) {
      const match = tcgPrices.find(
        (p) => p.sub_type_name === variant && p.market_price != null
      );
      if (match) {
        return {
          myr:    +(match.market_price * USD_TO_MYR).toFixed(2),
          source: `TCGPlayer ${match.sub_type_name}`,
        };
      }
    }
    // Any variant with a price
    const any = tcgPrices.find((p) => p.market_price != null);
    if (any) {
      return {
        myr:    +(any.market_price * USD_TO_MYR).toFixed(2),
        source: `TCGPlayer ${any.sub_type_name}`,
      };
    }
  }

  // 2. CardMarket fallback
  const cmPrices = card.cardmarket?.prices;
  if (cmPrices?.length) {
    for (const variant of CM_PRIORITY) {
      const match = cmPrices.find((p) => p.variant_type === variant);
      if (match) {
        const eur = match.avg30 ?? match.avg ?? match.trend;
        if (eur != null) {
          return {
            myr:    +(eur * EUR_TO_MYR).toFixed(2),
            source: `Cardmarket ${match.variant_type}`,
          };
        }
      }
    }
  }

  return null;
}
