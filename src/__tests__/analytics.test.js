import { describe, it, expect } from 'vitest';
import { computeStockItems, computeMetrics } from '../lib/analytics.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tx(lines, event = null) {
  return { transactionLines: lines, event };
}

function cardIn(cardExternalId, qty, unitPriceMyr, marketPriceMyr = 0, extra = {}) {
  return { type: 'card', side: 'in', cardExternalId, qty, unitPriceMyr, marketPriceMyr,
    cardName: 'Card', cardNumber: '001', cardSetName: 'Base', cardLang: 'EN', cardImageUrl: null, ...extra };
}

function cardOut(cardExternalId, qty) {
  return { type: 'card', side: 'out', cardExternalId, qty, unitPriceMyr: 0 };
}

function cashIn(amount)  { return { type: 'cash', side: 'in',  qty: 1, unitPriceMyr: amount }; }
function cashOut(amount) { return { type: 'cash', side: 'out', qty: 1, unitPriceMyr: amount }; }

function sealedIn(sealedName, qty, unitPriceMyr)  { return { type: 'sealed', side: 'in',  sealedName, qty, unitPriceMyr }; }
function sealedOut(sealedName, qty) { return { type: 'sealed', side: 'out', sealedName, qty, unitPriceMyr: 0 }; }

// ─── computeStockItems ────────────────────────────────────────────────────────

describe('computeStockItems', () => {
  it('returns [] for empty transactions', () => {
    expect(computeStockItems([])).toEqual([]);
  });

  it('returns [] for transactions with no lines', () => {
    expect(computeStockItems([tx([])])).toEqual([]);
  });

  it('single buy → qty and avgCost correct', () => {
    const items = computeStockItems([tx([cardIn('A', 2, 5)])]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ qty: 2, avgCost: 5, costBasis: 10 });
  });

  it('buy 4 sell 2 → pro-rata cost basis', () => {
    // costIn=40 (4×10), net=2, ratio=2/4=0.5, costBasis=20, avgCost=10
    const items = computeStockItems([
      tx([cardIn('A', 4, 10)]),
      tx([cardOut('A', 2)]),
    ]);
    expect(items[0]).toMatchObject({ qty: 2, costBasis: 20, avgCost: 10 });
  });

  it('buy and sell all → excluded (net ≤ 0)', () => {
    const items = computeStockItems([
      tx([cardIn('A', 2, 10)]),
      tx([cardOut('A', 2)]),
    ]);
    expect(items).toEqual([]);
  });

  it('card line with null cardExternalId (bulk) → excluded', () => {
    const items = computeStockItems([
      tx([{ type: 'card', side: 'in', cardExternalId: null, qty: 5, unitPriceMyr: 1, marketPriceMyr: 0 }]),
    ]);
    expect(items).toEqual([]);
  });

  it('sealed product tracked separately by sealedName', () => {
    const items = computeStockItems([tx([sealedIn('Booster Box', 2, 100)])]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'sealed', name: 'Booster Box', qty: 2, avgCost: 100 });
  });

  it('sealed name key is case-insensitive', () => {
    const items = computeStockItems([
      tx([sealedIn('Booster Box', 1, 100)]),
      tx([sealedIn('booster box', 1, 100)]),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(2);
  });

  it('price override replaces marketIn for avgMarket', () => {
    const overrides = new Map([['A', { priceMyr: 20 }]]);
    const items = computeStockItems([tx([cardIn('A', 2, 5, 8)])], overrides);
    // marketValue = 20 * 2 = 40, avgMarket = 40/2 = 20
    expect(items[0].avgMarket).toBe(20);
  });

  it('meta taken from first in-line only', () => {
    const items = computeStockItems([
      tx([cardIn('A', 1, 5, 0, { cardName: 'First' })]),
      tx([cardIn('A', 1, 5, 0, { cardName: 'Second' })]),
    ]);
    expect(items[0].name).toBe('First');
  });

  it('multiple cards tracked independently', () => {
    const items = computeStockItems([
      tx([cardIn('A', 1, 10), cardIn('B', 2, 5)]),
    ]);
    expect(items).toHaveLength(2);
    const keys = items.map((i) => i.key).sort();
    expect(keys).toEqual(['A', 'B']);
  });

  it('unrealizedGain = marketValue - costBasis', () => {
    const items = computeStockItems([tx([cardIn('A', 2, 5, 10)])]);
    // costBasis=10, marketValue=20
    expect(items[0].unrealizedGain).toBe(10);
  });
});

// ─── computeMetrics ───────────────────────────────────────────────────────────

describe('computeMetrics', () => {
  it('empty transactions → all zeros, empty breakdown', () => {
    const m = computeMetrics([]);
    expect(m.txCount).toBe(0);
    expect(m.cashIn).toBe(0);
    expect(m.cashOut).toBe(0);
    expect(m.netCash).toBe(0);
    expect(m.cardBuyQty).toBe(0);
    expect(m.cardSellQty).toBe(0);
    expect(m.stockQty).toBe(0);
    expect(m.eventBreakdown).toEqual([]);
  });

  it('sell transaction → cashIn and cardSellQty', () => {
    const m = computeMetrics([tx([cardOut('A', 2), cashIn(50)])]);
    expect(m.cashIn).toBe(50);
    expect(m.cardSellQty).toBe(2);
  });

  it('buy transaction → cashOut and cardBuyQty', () => {
    const m = computeMetrics([tx([cardIn('A', 3, 10), cashOut(30)])]);
    expect(m.cashOut).toBe(30);
    expect(m.cardBuyQty).toBe(3);
  });

  it('netCash = cashIn - cashOut', () => {
    const m = computeMetrics([
      tx([cashIn(100)]),
      tx([cashOut(60)]),
    ]);
    expect(m.netCash).toBe(40);
  });

  it('txCount counts each transaction', () => {
    const m = computeMetrics([tx([cashIn(10)]), tx([cashIn(10)]), tx([cashIn(10)])]);
    expect(m.txCount).toBe(3);
  });

  it('remaining stock after partial sells → stockQty and stockCost', () => {
    const m = computeMetrics([
      tx([cardIn('A', 4, 10, 15), cashOut(40)]),  // buy 4 @ 10, market 15
      tx([cardOut('A', 1), cashIn(20)]),            // sell 1
    ]);
    // net=3, ratio=3/4, stockCost=40*(3/4)=30, stockMarket=60*(3/4)=45
    expect(m.stockQty).toBe(3);
    expect(m.stockCost).toBe(30);
    expect(m.stockMarket).toBe(45);
    expect(m.unrealizedGain).toBe(15);
  });

  it('event breakdown groups by event id, walk-ins last', () => {
    const ev1 = { id: 'e1', name: 'Event 1' };
    const m = computeMetrics([
      tx([cashIn(10)], null),
      tx([cashIn(10)], ev1),
      tx([cashIn(10)], ev1),
    ]);
    expect(m.eventBreakdown).toHaveLength(2);
    expect(m.eventBreakdown[0].id).toBe('e1');
    expect(m.eventBreakdown[0].txCount).toBe(2);
    expect(m.eventBreakdown[1].id).toBe('__none__');
  });

  it('walk-in name defaults to "Walk-in"', () => {
    const m = computeMetrics([tx([cashIn(10)], null)]);
    expect(m.eventBreakdown[0].name).toBe('Walk-in');
  });

  it('event cashIn/cashOut/netCash per-event breakdown', () => {
    const ev1 = { id: 'e1', name: 'E1' };
    const m = computeMetrics([tx([cashIn(80), cashOut(30)], ev1)]);
    const ev = m.eventBreakdown[0];
    expect(ev.cashIn).toBe(80);
    expect(ev.cashOut).toBe(30);
    expect(ev.netCash).toBe(50);
  });

  it('card lines without cardExternalId ignored for stock', () => {
    const m = computeMetrics([
      tx([{ type: 'card', side: 'in', cardExternalId: null, qty: 5, unitPriceMyr: 10, marketPriceMyr: 10 }]),
    ]);
    expect(m.stockQty).toBe(0);
    expect(m.cardBuyQty).toBe(0);
  });

  // ── grossProfit per event ──────────────────────────────────────────────────

  it('grossProfit: card sold with avgCostMyr → correct gross profit', () => {
    const ev1 = { id: 'e1', name: 'E1' };
    // sell 2 cards @ RM 10 each, avgCost RM 6 → profit = (10-6)*2 = 8
    const line = { type: 'card', side: 'out', cardExternalId: 'A', qty: 2, unitPriceMyr: 10, avgCostMyr: 6 };
    const m = computeMetrics([tx([line, cashIn(20)], ev1)]);
    const ev = m.eventBreakdown[0];
    expect(ev.grossProfit).toBe(8);
    expect(ev.profitComplete).toBe(true);
  });

  it('grossProfit: card sold without avgCostMyr → profitComplete false, excluded from total', () => {
    const ev1 = { id: 'e1', name: 'E1' };
    const line = { type: 'card', side: 'out', cardExternalId: 'A', qty: 1, unitPriceMyr: 10, avgCostMyr: null };
    const m = computeMetrics([tx([line, cashIn(10)], ev1)]);
    const ev = m.eventBreakdown[0];
    expect(ev.grossProfit).toBe(0);
    expect(ev.profitComplete).toBe(false);
  });

  it('grossProfit: no card sales → grossProfit 0, profitComplete true', () => {
    const ev1 = { id: 'e1', name: 'E1' };
    const m = computeMetrics([tx([cashIn(50)], ev1)]);
    const ev = m.eventBreakdown[0];
    expect(ev.grossProfit).toBe(0);
    expect(ev.profitComplete).toBe(true);
  });

  it('grossProfit: mixed lines (some with, some without avgCostMyr) → profitComplete false', () => {
    const ev1 = { id: 'e1', name: 'E1' };
    const withCost    = { type: 'card', side: 'out', cardExternalId: 'A', qty: 1, unitPriceMyr: 10, avgCostMyr: 5 };
    const withoutCost = { type: 'card', side: 'out', cardExternalId: 'B', qty: 1, unitPriceMyr: 8,  avgCostMyr: null };
    const m = computeMetrics([tx([withCost, withoutCost, cashIn(18)], ev1)]);
    const ev = m.eventBreakdown[0];
    expect(ev.grossProfit).toBe(5); // only the card with cost data contributes
    expect(ev.profitComplete).toBe(false);
  });

  it('grossProfit: rounding to 2 decimal places', () => {
    const ev1 = { id: 'e1', name: 'E1' };
    // (10 - 3.333) * 3 = 20.001 → rounds to 20.00
    const line = { type: 'card', side: 'out', cardExternalId: 'A', qty: 3, unitPriceMyr: 10, avgCostMyr: 3.333 };
    const m = computeMetrics([tx([line, cashIn(30)], ev1)]);
    expect(m.eventBreakdown[0].grossProfit).toBe(20.00);
  });

  // ── global grossProfit ────────────────────────────────────────────────────

  it('global grossProfit: correct across all events', () => {
    const ev1 = { id: 'e1', name: 'E1' };
    const ev2 = { id: 'e2', name: 'E2' };
    const lineA = { type: 'card', side: 'out', cardExternalId: 'A', qty: 2, unitPriceMyr: 10, avgCostMyr: 6 };
    const lineB = { type: 'card', side: 'out', cardExternalId: 'B', qty: 1, unitPriceMyr: 15, avgCostMyr: 5 };
    const m = computeMetrics([
      tx([lineA, cashIn(20)], ev1),  // profit = 8
      tx([lineB, cashIn(15)], ev2),  // profit = 10
    ]);
    expect(m.grossProfit).toBe(18);
    expect(m.cardSoldTotal).toBe(3);
    expect(m.profitComplete).toBe(true);
  });

  it('global grossProfit: profitComplete false when any line missing avgCostMyr', () => {
    const line = { type: 'card', side: 'out', cardExternalId: 'A', qty: 1, unitPriceMyr: 10, avgCostMyr: null };
    const m = computeMetrics([tx([line, cashIn(10)])]);
    expect(m.profitComplete).toBe(false);
    expect(m.grossProfit).toBe(0);
  });

  it('global grossProfit: no card sales → grossProfit 0, profitComplete true', () => {
    const m = computeMetrics([tx([cashIn(50)])]);
    expect(m.grossProfit).toBe(0);
    expect(m.cardSoldTotal).toBe(0);
    expect(m.profitComplete).toBe(true);
  });
});
