/**
 * Aggregate raw per-key stock totals from transaction lines.
 * Internal helper shared by buildStockMap / computeStockItems.
 */
function buildStockAggregates(transactions) {
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
  return map;
}

/**
 * Derive a Map<key, item> of items currently in stock (net qty > 0).
 * Item shape matches computeStockItems entries — use this when callers need
 * O(1) lookup by key (CartLine stock badge, picker modals).
 */
export function buildStockMap(transactions, priceOverrides = new Map()) {
  const aggregates = buildStockAggregates(transactions);
  const map = new Map();
  for (const [key, s] of aggregates.entries()) {
    const net = s.qtyIn - s.qtyOut;
    if (net <= 0 || s.qtyIn === 0 || !s.meta) continue;
    const ratio = net / s.qtyIn;
    const costBasis = +(s.costIn * ratio).toFixed(2);
    const override = s.type === 'card' ? priceOverrides.get(key) : null;
    const marketValue = override
      ? +(override.priceMyr * net).toFixed(2)
      : +(s.marketIn * ratio).toFixed(2);
    if (s.type === 'card') {
      map.set(key, {
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
      map.set(key, {
        type:    'sealed',
        key,
        name:    s.meta.name,
        qty:     net,
        costBasis,
        avgCost: +(costBasis / net).toFixed(2),
      });
    }
  }
  return map;
}

/**
 * Derive a flat list of items currently in stock (net qty > 0).
 * Returns card items (keyed by cardExternalId) and sealed items (keyed by sealedName).
 * All monetary values in MYR.
 */
export function computeStockItems(transactions, priceOverrides = new Map()) {
  return Array.from(buildStockMap(transactions, priceOverrides).values());
}

/**
 * Same derived-field logic as buildStockMap, but input is the already-aggregated
 * rows returned by the get_org_stock RPC (loadStock in db.js). Each row has
 * { type, key, name, number, setName, lang, imageUrl, qtyIn, qtyOut, costIn, marketIn }.
 * Returns Map<key, item> with the same item shape buildStockMap produces.
 */
export function buildStockMapFromRows(rows, priceOverrides = new Map()) {
  const map = new Map();
  for (const row of rows) {
    const qtyIn  = Number(row.qtyIn)  || 0;
    const qtyOut = Number(row.qtyOut) || 0;
    const net    = qtyIn - qtyOut;
    if (net <= 0 || qtyIn === 0) continue;
    const ratio     = net / qtyIn;
    const costIn    = Number(row.costIn)   || 0;
    const marketIn  = Number(row.marketIn) || 0;
    const costBasis = +(costIn * ratio).toFixed(2);

    if (row.type === 'card') {
      const override = priceOverrides.get(row.key);
      const marketValue = override
        ? +(override.priceMyr * net).toFixed(2)
        : +(marketIn * ratio).toFixed(2);
      map.set(row.key, {
        type:           'card',
        key:            row.key,
        name:           row.name     ?? '',
        number:         row.number   ?? '',
        setName:        row.setName  ?? '',
        lang:           row.lang     ?? '',
        imageUrl:       row.imageUrl ?? null,
        qty:            net,
        costBasis,
        marketValue,
        avgCost:        +(costBasis   / net).toFixed(2),
        avgMarket:      +(marketValue / net).toFixed(2),
        unrealizedGain: +(marketValue - costBasis).toFixed(2),
        nameNorm:       row.nameNorm   ?? '',
        setNorm:        row.setNorm    ?? '',
        numberNorm:     row.numberNorm ?? '',
      });
    } else {
      map.set(row.key, {
        type:    'sealed',
        key:     row.key,
        name:    row.name ?? '',
        qty:     net,
        costBasis,
        avgCost: +(costBasis / net).toFixed(2),
        nameNorm: row.nameNorm ?? '',
      });
    }
  }
  return map;
}

/**
 * Derive P&L, stock value, and per-event breakdown from saved transactions.
 * Optionally include event misc costs and monthly fixed costs.
 * All values in MYR.
 */
export function computeMetrics(transactions, miscCosts = [], fixedCosts = []) {
  let txCount          = 0;
  let cashIn           = 0;
  let cashOut          = 0;
  let totalIn          = 0;
  let totalOut         = 0;
  let cardBuyQty       = 0;
  let cardSellQty      = 0;
  let grossProfit      = 0;
  let cogs             = 0;
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
                          totalIn: 0, totalOut: 0,
                          grossProfit: 0, cardSoldTotal: 0, cardSoldWithCost: 0 });
    }
    const ev = byEvent.get(evId);
    ev.txCount++;

    for (const line of tx.transactionLines ?? []) {
      const value = (line.unitPriceMyr || 0) * line.qty;

      if (line.type === 'card' || line.type === 'sealed') {
        if (line.side === 'in') { totalIn  += value; ev.totalIn  += value; }
        else                    { totalOut += value; ev.totalOut += value; }
      }

      if (line.side === 'in') {
        if (line.type === 'cash') {
          cashIn   += value;
          ev.cashIn += value;
        } else if (line.type === 'card' && line.cardExternalId) {
          cardBuyQty += line.qty;
          const isImport = tx.notes?.startsWith('Stock import') || tx.notes?.startsWith('Stock addition');
          if (value && isImport) {
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
        } else if (line.type === 'card') {
          if (line.cardExternalId) {
            cardSellQty += line.qty;
            const id = String(line.cardExternalId);
            if (!stockMap.has(id)) stockMap.set(id, { qtyIn: 0, qtyOut: 0, costIn: 0, marketIn: 0 });
            stockMap.get(id).qtyOut += line.qty;
          }
          ev.cardSoldTotal += line.qty;
          cardSoldTotal    += line.qty;
          const effectiveCost = line.cardExternalId == null
            ? (line.avgCostMyr ?? 0)
            : line.avgCostMyr;
          if (effectiveCost != null) {
            ev.grossProfit      += ((line.unitPriceMyr || 0) - effectiveCost) * line.qty;
            ev.cardSoldWithCost += line.qty;
            grossProfit         += ((line.unitPriceMyr || 0) - effectiveCost) * line.qty;
            cogs                += effectiveCost * line.qty;
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

  // New gross profit formula: revenue + stock on hand - total purchases
  grossProfit = totalOut + stockCost - totalIn;

  // Misc costs aggregated per event
  const miscByEvent = new Map();
  for (const c of miscCosts) {
    miscByEvent.set(c.eventId, (miscByEvent.get(c.eventId) ?? 0) + (c.amountMyr || 0));
  }
  const totalMiscCosts = [...miscByEvent.values()].reduce((a, b) => a + b, 0);
  const totalFixedCosts = fixedCosts.reduce((s, c) => s + (c.amountMyr || 0), 0);

  // Per-event breakdown — newest by txCount desc, walk-ins at the end
  const eventBreakdown = [...byEvent.entries()]
    .map(([id, d]) => {
      const miscCostTotal = +(miscByEvent.get(id) ?? 0).toFixed(2);
      return {
        id,
        name:    d.name ?? 'Walk-in',
        txCount: d.txCount,
        cashIn:  d.cashIn,
        cashOut: d.cashOut,
        totalIn:  d.totalIn,
        totalOut: d.totalOut,
        netCashFlow:    d.cashIn - d.cashOut,
        grossProfit:    +d.grossProfit.toFixed(2),
        cardSoldTotal:  d.cardSoldTotal,
        profitComplete: d.cardSoldTotal === 0 || d.cardSoldWithCost === d.cardSoldTotal,
        miscCostTotal,
        netPL: +(d.grossProfit - miscCostTotal).toFixed(2),
      };
    })
    .sort((a, b) => {
      if (a.id === '__none__') return 1;
      if (b.id === '__none__') return -1;
      return b.txCount - a.txCount;
    });

  return {
    txCount,
    cashIn,
    cashOut,
    totalIn,
    totalOut,
    netCashFlow:     cashIn - cashOut,
    grossProfit:     +grossProfit.toFixed(2),
    cogs:            +cogs.toFixed(2),
    cardSoldTotal,
    profitComplete:  cardSoldTotal === 0 || cardSoldWithCost === cardSoldTotal,
    cardBuyQty,
    cardSellQty,
    stockQty,
    stockCost:       +stockCost.toFixed(2),
    stockMarket:     +stockMarket.toFixed(2),
    unrealizedGain:  +(stockMarket - stockCost).toFixed(2),
    totalMiscCosts:  +totalMiscCosts.toFixed(2),
    totalFixedCosts: +totalFixedCosts.toFixed(2),
    netPL:           +(grossProfit - totalMiscCosts - totalFixedCosts).toFixed(2),
    eventBreakdown,
  };
}

/**
 * Compute P&L for a single month using the opening/closing stock formula:
 *   Gross Profit = Revenue − Opening Stock − Purchases + Closing Stock
 *
 * Opening stock = cost of all stock held at end of previous month.
 * Closing stock = cost of all stock held at end of selected month.
 * For the first month with data, opening stock is naturally 0.
 */
export function computeMonthlyPL(transactions, miscCosts, fixedCosts, events, ym) {
  const toYM = (iso) => (iso ?? '').slice(0, 7);

  function stockCostAt(endYM) {
    const stockMap = new Map();
    for (const tx of transactions) {
      if (toYM(tx.createdAt) > endYM) continue;
      for (const line of tx.transactionLines ?? []) {
        let key;
        if      (line.type === 'card'   && line.cardExternalId) key = `card:${line.cardExternalId}`;
        else if (line.type === 'sealed' && line.sealedName)     key = `sealed:${line.sealedName.toLowerCase()}`;
        else continue;
        if (!stockMap.has(key)) stockMap.set(key, { qtyIn: 0, qtyOut: 0, costIn: 0 });
        const s = stockMap.get(key);
        if (line.side === 'in') { s.qtyIn += line.qty; s.costIn += (line.unitPriceMyr || 0) * line.qty; }
        else                    { s.qtyOut += line.qty; }
      }
    }
    let total = 0;
    for (const s of stockMap.values()) {
      const net = s.qtyIn - s.qtyOut;
      if (net > 0 && s.qtyIn > 0) total += s.costIn * (net / s.qtyIn);
    }
    return total;
  }

  const [year, month] = ym.split('-').map(Number);
  // Pure string arithmetic — avoids local-tz drift when `new Date(y, m, 1)` is converted to UTC.
  const prevY = month === 1 ? year - 1 : year;
  const prevM = month === 1 ? 12 : month - 1;
  const prevYM = `${prevY}-${String(prevM).padStart(2, '0')}`;

  const openingStock = stockCostAt(prevYM);
  const closingStock = stockCostAt(ym);

  const txs = transactions.filter((tx) => toYM(tx.createdAt) === ym);
  let revenue = 0, purchases = 0, txCount = 0, cardBuyQty = 0, cardSellQty = 0, sealedBuyQty = 0, sealedSellQty = 0;
  for (const tx of txs) {
    txCount++;
    for (const line of tx.transactionLines ?? []) {
      if (line.type !== 'card' && line.type !== 'sealed') continue;
      const value = (line.unitPriceMyr || 0) * line.qty;
      if (line.side === 'out') {
        revenue += value;
        if (line.type === 'card')   cardSellQty   += line.qty;
        if (line.type === 'sealed') sealedSellQty += line.qty;
      } else {
        purchases += value;
        if (line.type === 'card')   cardBuyQty  += line.qty;
        if (line.type === 'sealed') sealedBuyQty += line.qty;
      }
    }
  }

  const grossProfit = revenue - openingStock - purchases + closingStock;

  const eventMonth = new Map();
  for (const e of events) {
    if (e.startsAt) eventMonth.set(e.id, toYM(e.startsAt));
  }
  const mc = miscCosts
    .filter((c) => (eventMonth.get(c.eventId) ?? toYM(c.createdAt)) === ym)
    .reduce((s, c) => s + (c.amountMyr || 0), 0);
  const fc = fixedCosts
    .filter((c) => toYM(c.month) === ym)
    .reduce((s, c) => s + (c.amountMyr || 0), 0);

  return {
    txCount,
    cardBuyQty,
    cardSellQty,
    sealedBuyQty,
    sealedSellQty,
    revenue:      +revenue.toFixed(2),
    purchases:    +purchases.toFixed(2),
    openingStock: +openingStock.toFixed(2),
    closingStock: +closingStock.toFixed(2),
    grossProfit:  +grossProfit.toFixed(2),
    miscCosts:    +mc.toFixed(2),
    fixedCosts:   +fc.toFixed(2),
    netPL:        +(grossProfit - mc - fc).toFixed(2),
  };
}

/**
 * Build a month-by-month P&L breakdown for export.
 * miscCosts entries are assigned to the month of their event's starts_at,
 * falling back to the cost's own created_at.
 * fixedCosts entries use their `month` field (YYYY-MM-01).
 */
export function buildMonthlyPL(transactions, miscCosts, fixedCosts, events) {
  const toYM = (iso) => (iso ?? '').slice(0, 7); // 'YYYY-MM'

  // event id → startsAt month
  const eventMonth = new Map();
  for (const e of events) {
    if (e.startsAt) eventMonth.set(e.id, toYM(e.startsAt));
  }

  // collect all months present in data
  const monthSet = new Set();
  for (const tx of transactions) monthSet.add(toYM(tx.createdAt));
  for (const c  of miscCosts)     monthSet.add(eventMonth.get(c.eventId) ?? toYM(c.createdAt));
  for (const c  of fixedCosts)    monthSet.add(toYM(c.month));
  monthSet.delete('');

  const months = [...monthSet].sort();

  return months.map((ym) => {
    // transactions in this month
    const txs = transactions.filter((tx) => toYM(tx.createdAt) === ym);
    let sales = 0, purchases = 0, gp = 0;
    for (const tx of txs) {
      for (const line of tx.transactionLines ?? []) {
        const value = (line.unitPriceMyr || 0) * line.qty;
        if (line.type === 'card' || line.type === 'sealed') {
          if (line.side === 'out') sales     += value;
          else                     purchases += value;
        }
        if (line.type === 'card' && line.side === 'out') {
          const effectiveCost = line.cardExternalId == null
            ? (line.avgCostMyr ?? 0)
            : line.avgCostMyr;
          if (effectiveCost != null) {
            gp += ((line.unitPriceMyr || 0) - effectiveCost) * line.qty;
          }
        }
      }
    }

    const mc = miscCosts
      .filter((c) => (eventMonth.get(c.eventId) ?? toYM(c.createdAt)) === ym)
      .reduce((s, c) => s + (c.amountMyr || 0), 0);

    const fc = fixedCosts
      .filter((c) => toYM(c.month) === ym)
      .reduce((s, c) => s + (c.amountMyr || 0), 0);

    return {
      month:      ym,
      sales:      +sales.toFixed(2),
      purchases:  +purchases.toFixed(2),
      grossProfit: +gp.toFixed(2),
      miscCosts:  +mc.toFixed(2),
      fixedCosts: +fc.toFixed(2),
      netPL:      +(gp - mc - fc).toFixed(2),
    };
  });
}
