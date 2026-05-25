// Parity test for Tier 1A SQL RPCs against the JS analytics functions.
//
// Runs the new server-side aggregates (get_org_metrics, get_org_event_breakdown,
// get_org_monthly_pl) for a chosen org, then runs the JS reference implementations
// (computeMetrics, computeMonthlyPL) over the *full* transaction history of the
// same org, and reports per-field diffs.
//
// Usage:
//   VITE_SUPABASE_URL=...
//   SUPABASE_SERVICE_ROLE_KEY=...   # bypasses RLS — use staging only
//   PARITY_ORG_ID=<uuid>
//   node scripts/parity-check.mjs
//
// The service role key bypasses RLS so every transaction is visible.
// Run against staging, never prod.

import { createClient } from '@supabase/supabase-js';
import { computeMetrics, computeMonthlyPL } from '../src/lib/analytics.js';

const url     = process.env.VITE_SUPABASE_URL;
const key     = process.env.SUPABASE_SERVICE_ROLE_KEY;
const orgId   = process.env.PARITY_ORG_ID;
const epsilon = 0.01;  // 1 cent

if (!url || !key || !orgId) {
  console.error('Missing env vars. Need VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PARITY_ORG_ID.');
  process.exit(2);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

// ─── helpers ────────────────────────────────────────────────────────────────

function toCamel(o) {
  if (Array.isArray(o)) return o.map(toCamel);
  if (o !== null && typeof o === 'object') {
    return Object.fromEntries(
      Object.entries(o).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), toCamel(v)])
    );
  }
  return o;
}

let failures = 0;
let checks   = 0;

function eqNum(label, rpc, js) {
  checks++;
  const a = Number(rpc ?? 0), b = Number(js ?? 0);
  if (Math.abs(a - b) > epsilon) {
    failures++;
    console.log(`  ✗ ${label}: RPC=${a}  JS=${b}  Δ=${(a - b).toFixed(4)}`);
  } else {
    console.log(`  ✓ ${label}: ${a}`);
  }
}

function eqInt(label, rpc, js) {
  checks++;
  const a = Number(rpc ?? 0), b = Number(js ?? 0);
  if (a !== b) {
    failures++;
    console.log(`  ✗ ${label}: RPC=${a}  JS=${b}`);
  } else {
    console.log(`  ✓ ${label}: ${a}`);
  }
}

function eqBool(label, rpc, js) {
  checks++;
  if (Boolean(rpc) !== Boolean(js)) {
    failures++;
    console.log(`  ✗ ${label}: RPC=${rpc}  JS=${js}`);
  } else {
    console.log(`  ✓ ${label}: ${rpc}`);
  }
}

// ─── fetch raw data for JS reference ────────────────────────────────────────

async function fetchAll(table, cols, extras = (q) => q) {
  const PAGE = 1000;
  let from = 0;
  const out = [];
  while (true) {
    let q = supabase.from(table).select(cols).range(from, from + PAGE - 1);
    q = extras(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function fetchAllTransactions() {
  return fetchAll(
    'transaction',
    `id, created_at, notes, payment_method,
     event:event!event_id(id, name),
     transaction_lines(
       id, side, type,
       card_external_id, card_name, card_number, card_set_name, card_lang, card_image_url,
       avg_cost_myr, market_price_myr, price_source,
       sealed_name, sealed_reference_price, sealed_catalog_id,
       qty, unit_price_myr
     )`,
    (q) => q.eq('org_id', orgId).is('deleted_at', null).order('created_at', { ascending: false }),
  );
}

// ─── run ────────────────────────────────────────────────────────────────────

console.log(`Parity check for org ${orgId}`);
console.log(`Endpoint: ${url}\n`);

const t0 = Date.now();

const [rpcMetricsRaw, rpcEventsRaw, rpcMonthlyRaw, txRows, miscRows, fixedRows, eventRows] = await Promise.all([
  supabase.rpc('get_org_metrics',           { p_org_id: orgId }).then(r => { if (r.error) throw r.error; return r.data; }),
  supabase.rpc('get_org_event_breakdown',   { p_org_id: orgId }).then(r => { if (r.error) throw r.error; return r.data; }),
  supabase.rpc('get_org_monthly_pl',        { p_org_id: orgId }).then(r => { if (r.error) throw r.error; return r.data; }),
  fetchAllTransactions(),
  fetchAll('event_misc_cost', 'id, event_id, label, amount_myr, created_at', (q) => q.eq('org_id', orgId)),
  fetchAll('fixed_cost',      'id, label, amount_myr, month, created_at',     (q) => q.eq('org_id', orgId)),
  fetchAll('event',           'id, name, starts_at, ends_at',                 (q) => q.eq('org_id', orgId).is('deleted_at', null)),
]);

const fetchMs = Date.now() - t0;

const transactions = toCamel(txRows);
const miscCosts    = toCamel(miscRows);
const fixedCosts   = toCamel(fixedRows);
const events       = toCamel(eventRows);
const rpcMetrics   = toCamel(Array.isArray(rpcMetricsRaw) ? rpcMetricsRaw[0] : rpcMetricsRaw);
const rpcEvents    = toCamel(rpcEventsRaw ?? []);
const rpcMonthly   = toCamel(rpcMonthlyRaw ?? []);

console.log(`Fetched ${transactions.length} txs, ${miscCosts.length} misc, ${fixedCosts.length} fixed, ${events.length} events in ${fetchMs}ms\n`);

// ─── global metrics ─────────────────────────────────────────────────────────

console.log('─── get_org_metrics ──────────────────────────────────────────');
const jsMetrics = computeMetrics(transactions, miscCosts, fixedCosts);

eqInt ('tx_count',         rpcMetrics.txCount,        jsMetrics.txCount);
eqNum ('cash_in',          rpcMetrics.cashIn,         jsMetrics.cashIn);
eqNum ('cash_out',         rpcMetrics.cashOut,        jsMetrics.cashOut);
eqNum ('total_in',         rpcMetrics.totalIn,        jsMetrics.totalIn);
eqNum ('total_out',        rpcMetrics.totalOut,       jsMetrics.totalOut);
eqNum ('net_cash_flow',    rpcMetrics.netCashFlow,    jsMetrics.netCashFlow);
eqInt ('card_buy_qty',     rpcMetrics.cardBuyQty,     jsMetrics.cardBuyQty);
eqInt ('card_sell_qty',    rpcMetrics.cardSellQty,    jsMetrics.cardSellQty);
eqInt ('card_sold_total',  rpcMetrics.cardSoldTotal,  jsMetrics.cardSoldTotal);
eqBool('profit_complete',  rpcMetrics.profitComplete, jsMetrics.profitComplete);
eqNum ('cogs',             rpcMetrics.cogs,           jsMetrics.cogs);
eqInt ('stock_qty',        rpcMetrics.stockQty,       jsMetrics.stockQty);
eqNum ('stock_cost',       rpcMetrics.stockCost,      jsMetrics.stockCost);
eqNum ('stock_market',     rpcMetrics.stockMarket,    jsMetrics.stockMarket);
eqNum ('unrealized_gain',  rpcMetrics.unrealizedGain, jsMetrics.unrealizedGain);
eqNum ('gross_profit',     rpcMetrics.grossProfit,    jsMetrics.grossProfit);
eqNum ('total_misc_costs', rpcMetrics.totalMiscCosts, jsMetrics.totalMiscCosts);
eqNum ('total_fixed_costs',rpcMetrics.totalFixedCosts,jsMetrics.totalFixedCosts);
eqNum ('net_pl',           rpcMetrics.netPl,          jsMetrics.netPL);

// ─── event breakdown ────────────────────────────────────────────────────────

console.log('\n─── get_org_event_breakdown ──────────────────────────────────');
const jsBreakdown = jsMetrics.eventBreakdown;
// Map RPC NULL eventId → '__none__' to match JS sentinel
const rpcByKey = new Map(rpcEvents.map(r => [r.eventId ?? '__none__', r]));

if (rpcEvents.length !== jsBreakdown.length) {
  failures++;
  console.log(`  ✗ event count mismatch: RPC=${rpcEvents.length}  JS=${jsBreakdown.length}`);
}

for (const jsEv of jsBreakdown) {
  const rpcEv = rpcByKey.get(jsEv.id);
  if (!rpcEv) {
    failures++;
    console.log(`  ✗ event ${jsEv.id} (${jsEv.name}) missing from RPC`);
    continue;
  }
  console.log(`  event: ${jsEv.name} (${jsEv.id})`);
  eqInt ('    tx_count',        rpcEv.txCount,         jsEv.txCount);
  eqNum ('    cash_in',         rpcEv.cashIn,          jsEv.cashIn);
  eqNum ('    cash_out',        rpcEv.cashOut,         jsEv.cashOut);
  eqNum ('    total_in',        rpcEv.totalIn,         jsEv.totalIn);
  eqNum ('    total_out',       rpcEv.totalOut,        jsEv.totalOut);
  eqNum ('    net_cash_flow',   rpcEv.netCashFlow,     jsEv.netCashFlow);
  eqNum ('    gross_profit',    rpcEv.grossProfit,     jsEv.grossProfit);
  eqInt ('    card_sold_total', rpcEv.cardSoldTotal,   jsEv.cardSoldTotal);
  eqBool('    profit_complete', rpcEv.profitComplete,  jsEv.profitComplete);
  eqNum ('    misc_cost_total', rpcEv.miscCostTotal,   jsEv.miscCostTotal);
  eqNum ('    net_pl',          rpcEv.netPl,           jsEv.netPL);
}

// ─── monthly P&L ────────────────────────────────────────────────────────────

console.log('\n─── get_org_monthly_pl ───────────────────────────────────────');
const months = rpcMonthly.map(r => r.month);
for (const ym of months) {
  const rpcRow = rpcMonthly.find(r => r.month === ym);
  const jsRow  = computeMonthlyPL(transactions, miscCosts, fixedCosts, events, ym);
  console.log(`  month: ${ym}`);
  eqInt ('    tx_count',      rpcRow.txCount,      jsRow.txCount);
  eqInt ('    card_buy_qty',  rpcRow.cardBuyQty,   jsRow.cardBuyQty);
  eqInt ('    card_sell_qty', rpcRow.cardSellQty,  jsRow.cardSellQty);
  eqNum ('    revenue',       rpcRow.revenue,      jsRow.revenue);
  eqNum ('    purchases',     rpcRow.purchases,    jsRow.purchases);
  eqNum ('    opening_stock', rpcRow.openingStock, jsRow.openingStock);
  eqNum ('    closing_stock', rpcRow.closingStock, jsRow.closingStock);
  eqNum ('    gross_profit',  rpcRow.grossProfit,  jsRow.grossProfit);
  eqNum ('    misc_costs',    rpcRow.miscCosts,    jsRow.miscCosts);
  eqNum ('    fixed_costs',   rpcRow.fixedCosts,   jsRow.fixedCosts);
  eqNum ('    net_pl',        rpcRow.netPl,        jsRow.netPL);
}

// ─── summary ────────────────────────────────────────────────────────────────

console.log(`\n${failures === 0 ? '✓' : '✗'} ${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
