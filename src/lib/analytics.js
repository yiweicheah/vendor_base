/**
 * Derive a flat list of items currently in stock (net qty > 0).
 * Returns card items (keyed by cardExternalId) and sealed items (keyed by sealedName).
 * All monetary values in MYR.
 */
export function computeStockItems(transactions, priceOverrides = new Map()) {
  // key → { type, meta, qtyIn, qtyOut, costIn, marketIn }
  const map = new Map();

  for (const tx of transactions) {
    for (const line of tx.transactionLines ?? []) {
      if (line.type === 'card' && line.cardExternalId) {
        const key = String(line.cardExternalId);
        if (!map.has(key)) {
          map.set(key, { type: 'card', meta: null, qtyIn: 0, qtyOut: 0, costIn: 0, marketIn: 0 });
        }
        const s = map.get(key);
        const value = (line.unitPriceMyr || 0) * line.qty;
        if (line.side === 'in') {
          s.qtyIn    += line.qty;
          s.costIn   += value;
          s.marketIn += (line.marketPriceMyr || 0) * line.qty;
          if (!s.meta) {
            s.meta = {
              name:     line.cardName    ?? '',
              number:   line.cardNumber  ?? '',
              setName:  line.cardSetName ?? '',
              lang:     line.cardLang    ?? '',
              imageUrl: line.cardImageUrl ?? null,
            };
          }
        } else {
          s.qtyOut += line.qty;
        }
      } else if (line.type === 'sealed' && line.sealedName) {
        const key = line.sealedName.toLowerCase();
        if (!map.has(key)) {
          map.set(key, { type: 'sealed', meta: { name: line.sealedName }, qtyIn: 0, qtyOut: 0, costIn: 0, marketIn: 0 });
        }
        const s = map.get(key);
        const value = (line.unitPriceMyr || 0) * line.qty;
        if (line.side === 'in') {
          s.qtyIn  += line.qty;
          s.costIn += value;
        } else {
          s.qtyOut += line.qty;
        }
      }
    }
  }

  const items = [];
  for (const [key, s] of map.entries()) {
    const net = s.qtyIn - s.qtyOut;
    if (net <= 0 || s.qtyIn === 0 || !s.meta) continue;
    const ratio = net / s.qtyIn;
    const costBasis = +(s.costIn * ratio).toFixed(2);
    const override = s.type === 'card' ? priceOverrides.get(key) : null;
    const marketValue = override
      ? +(override.priceMyr * net).toFixed(2)
      : +(s.marketIn * ratio).toFixed(2);
    if (s.type === 'card') {
      items.push({
        type:           'card',
        key,
        ...s.meta,
        qty:            net,
        costBasis,
        marketValue,
        avgCost:        +(costBasis   / net).toFixed(2),
        avgMarket:      +(marketValue / net).toFixed(2),
        unrealizedGain: +(marketValue - costBasis).toFixed(2),
      });
    } else {
      items.push({
        type:    'sealed',
        key,
        name:    s.meta.name,
        qty:     net,
        costBasis,
        avgCost: +(costBasis / net).toFixed(2),
      });
    }
  }

  return items;
}

/**
 * Derive P&L, stock value, and per-event breakdown from saved transactions.
 * All values in MYR.
 */
export function computeMetrics(transactions) {
  let txCount          = 0;
  let cashIn           = 0;
  let cashOut          = 0;
  let cardBuyQty       = 0;
  let cardSellQty      = 0;
  let grossProfit      = 0;
  let cardSoldTotal    = 0;
  let cardSoldWithCost = 0;

  // cardId → { qtyIn, qtyOut, costIn (RM paid), marketIn (RM market at buy time) }
  const stockMap = new Map();

  // eventId → { name, txCount, cashIn, cashOut }
  const byEvent = new Map();

  for (const tx of transactions) {
    txCount++;

    const evId   = tx.event?.id   ?? '__none__';
    const evName = tx.event?.name ?? null;

    if (!byEvent.has(evId)) {
      byEvent.set(evId, { name: evName, txCount: 0, cashIn: 0, cashOut: 0,
                          grossProfit: 0, cardSoldTotal: 0, cardSoldWithCost: 0 });
    }
    const ev = byEvent.get(evId);
    ev.txCount++;

    for (const line of tx.transactionLines ?? []) {
      const value = (line.unitPriceMyr || 0) * line.qty;

      if (line.side === 'in') {
        if (line.type === 'cash') {
          cashIn   += value;
          ev.cashIn += value;
        } else if (line.type === 'card' && line.cardExternalId) {
          cardBuyQty += line.qty;
          if (value) {
            cashOut    += value;
            ev.cashOut += value;
          }
          const id = String(line.cardExternalId);
          if (!stockMap.has(id)) stockMap.set(id, { qtyIn: 0, qtyOut: 0, costIn: 0, marketIn: 0 });
          const s = stockMap.get(id);
          s.qtyIn    += line.qty;
          s.costIn   += value;
          s.marketIn += (line.marketPriceMyr || 0) * line.qty;
        }
      } else {
        if (line.type === 'cash') {
          cashOut   += value;
          ev.cashOut += value;
        } else if (line.type === 'card' && line.cardExternalId) {
          cardSellQty += line.qty;
          const id = String(line.cardExternalId);
          if (!stockMap.has(id)) stockMap.set(id, { qtyIn: 0, qtyOut: 0, costIn: 0, marketIn: 0 });
          stockMap.get(id).qtyOut += line.qty;
          ev.cardSoldTotal += line.qty;
          cardSoldTotal    += line.qty;
          if (line.avgCostMyr != null) {
            ev.grossProfit      += ((line.unitPriceMyr || 0) - line.avgCostMyr) * line.qty;
            ev.cardSoldWithCost += line.qty;
            grossProfit         += ((line.unitPriceMyr || 0) - line.avgCostMyr) * line.qty;
            cardSoldWithCost    += line.qty;
          }
        }
      }
    }
  }

  // Stock value — pro-rata the cost/market of remaining units
  let stockQty    = 0;
  let stockCost   = 0;
  let stockMarket = 0;

  for (const s of stockMap.values()) {
    const net = s.qtyIn - s.qtyOut;
    if (net <= 0 || s.qtyIn === 0) continue;
    const ratio  = net / s.qtyIn;
    stockQty    += net;
    stockCost   += s.costIn   * ratio;
    stockMarket += s.marketIn * ratio;
  }

  // Per-event breakdown — newest by txCount desc, walk-ins at the end
  const eventBreakdown = [...byEvent.entries()]
    .map(([id, d]) => ({
      id,
      name:    d.name ?? 'Walk-in',
      txCount: d.txCount,
      cashIn:  d.cashIn,
      cashOut: d.cashOut,
      netCash:        d.cashIn - d.cashOut,
      grossProfit:    +d.grossProfit.toFixed(2),
      cardSoldTotal:  d.cardSoldTotal,
      profitComplete: d.cardSoldTotal === 0 || d.cardSoldWithCost === d.cardSoldTotal,
    }))
    .sort((a, b) => {
      if (a.id === '__none__') return 1;
      if (b.id === '__none__') return -1;
      return b.txCount - a.txCount;
    });

  return {
    txCount,
    cashIn,
    cashOut,
    netCash:         cashIn - cashOut,
    grossProfit:     +grossProfit.toFixed(2),
    cardSoldTotal,
    profitComplete:  cardSoldTotal === 0 || cardSoldWithCost === cardSoldTotal,
    cardBuyQty,
    cardSellQty,
    stockQty,
    stockCost:       +stockCost.toFixed(2),
    stockMarket:     +stockMarket.toFixed(2),
    unrealizedGain:  +(stockMarket - stockCost).toFixed(2),
    eventBreakdown,
  };
}
