import { getRates } from './exchangeRates';

export function usdToMyr(usd) {
  return +(usd * getRates().USD_TO_MYR).toFixed(2);
}

export function eurToMyr(eur) {
  return +(eur * getRates().EUR_TO_MYR).toFixed(2);
}

export function calcPct(enteredMyr, marketMyr) {
  if (!enteredMyr || !marketMyr || marketMyr === 0) return null;
  return Math.round((enteredMyr / marketMyr) * 100);
}

export function pctColor(pct, side) {
  if (pct == null) return 'gray';
  if (side === 'in') {
    if (pct <= 75) return 'green';
    if (pct <= 90) return 'yellow';
    return 'red';
  }
  if (pct >= 95) return 'green';
  if (pct >= 85) return 'yellow';
  return 'red';
}
