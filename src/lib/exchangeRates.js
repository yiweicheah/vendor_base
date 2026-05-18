const FALLBACK = { USD_TO_MYR: 4.5, EUR_TO_MYR: 5.0 };

let rates = { ...FALLBACK };
let lastFetched = null;

export async function fetchExchangeRates() {
  try {
    const [usdRes, eurRes] = await Promise.all([
      fetch("https://api.frankfurter.dev/v2/rates?base=USD&quotes=MYR"),
      fetch("https://api.frankfurter.dev/v2/rates?base=EUR&quotes=MYR"),
    ]);
    if (!usdRes.ok || !eurRes.ok) throw new Error("fetch failed");
    const [usdData, eurData] = await Promise.all([
      usdRes.json(),
      eurRes.json(),
    ]);
    // frankfurter.dev v2 returns an array: [{ base, quote, rate, date }]
    rates = {
      USD_TO_MYR: usdData[0].rate,
      EUR_TO_MYR: eurData[0].rate,
    };
    lastFetched = new Date();
  } catch (err) {
    console.warn("Exchange rate fetch failed, using fallback:", err.message);
  }
}

export function getRates() {
  return rates;
}

export function getLastFetched() {
  return lastFetched;
}
