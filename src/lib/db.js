import { supabase } from './supabase';

// ─── Case conversion helpers ──────────────────────────────────────────────────

function toCamel(obj) {
  if (Array.isArray(obj)) return obj.map(toCamel);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        toCamel(v),
      ])
    );
  }
  return obj;
}

function toSnake(str) {
  return str.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

function toSnakeObj(obj) {
  if (Array.isArray(obj)) return obj.map(toSnakeObj);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [toSnake(k), toSnakeObj(v)])
    );
  }
  return obj;
}

// ─── User ──────────────────────────────────────────────────────────────────────

/**
 * Look up or create the DB user record for a Supabase auth user.
 * Returns { id, uid, displayName, email } (camelCase).
 */
export async function resolveUser(supabaseUser) {
  try {
    const { data: existing } = await supabase
      .from('user')
      .select('id, uid, display_name, email')
      .eq('uid', supabaseUser.id)
      .maybeSingle();

    if (existing) {
      const authName =
        supabaseUser.user_metadata?.display_name ||
        supabaseUser.user_metadata?.full_name ||
        '';
      if (!existing.display_name && authName) {
        const { data: updated } = await supabase
          .from('user')
          .update({ display_name: authName })
          .eq('id', existing.id)
          .select('id, uid, display_name, email')
          .single();
        if (updated) return toCamel(updated);
      }
      return toCamel(existing);
    }

    const displayName =
      supabaseUser.user_metadata?.display_name ||
      supabaseUser.user_metadata?.full_name ||
      '';

    const { data: created, error } = await supabase
      .from('user')
      .insert({ uid: supabaseUser.id, display_name: displayName, email: supabaseUser.email ?? '' })
      .select('id, uid, display_name, email')
      .single();

    if (error) throw error;
    return toCamel(created);
  } catch (err) {
    console.error('resolveUser error:', err);
    return null;
  }
}

export async function updateUserDisplayName({ dbId, displayName }) {
  const { error } = await supabase
    .from('user')
    .update({ display_name: displayName })
    .eq('id', dbId);
  if (error) throw error;
}

// ─── Org membership ───────────────────────────────────────────────────────────

/**
 * Load all org memberships for the given DB user UUID.
 * Returns [{ org: { id, name, slug, memberLimit }, role }].
 */
export async function loadAllMemberships(dbUserId) {
  try {
    const { data, error } = await supabase
      .from('organization_members')
      .select('role, org:organization!org_id(id, name, slug, member_limit)')
      .eq('user_id', dbUserId);
    if (error) throw error;
    return (data ?? []).map((m) => ({ org: toCamel(m.org), role: m.role }));
  } catch (err) {
    console.error('loadAllMemberships error:', err);
    return [];
  }
}

// ─── Dashboard aggregates (server-side RPCs) ─────────────────────────────────

// toCamel turns net_pl into netPl; the JS analytics contract uses netPL (acronym
// stays uppercase). Normalize before handing to React.
function fixNetPL(obj) {
  if (obj && Object.prototype.hasOwnProperty.call(obj, 'netPl')) {
    obj.netPL = obj.netPl;
    delete obj.netPl;
  }
  return obj;
}

/**
 * Global P&L / cash / stock metrics for an org. Server-side equivalent of
 * computeMetrics(transactions, miscCosts, fixedCosts) in src/lib/analytics.js
 * minus the eventBreakdown array (use loadEventBreakdown for that).
 * Returns a single object with camelCase keys.
 */
export async function loadMetrics(orgId) {
  const { data, error } = await supabase.rpc('get_org_metrics', { p_org_id: orgId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? fixNetPL(toCamel(row)) : null;
}

/**
 * Per-event breakdown for an org. Server-side equivalent of
 * computeMetrics(...).eventBreakdown. Walk-in rows are exposed with
 * id='__none__' (matching the JS contract used by ByEventSection).
 */
export async function loadEventBreakdown(orgId) {
  const { data, error } = await supabase.rpc('get_org_event_breakdown', { p_org_id: orgId });
  if (error) throw error;
  return toCamel(data ?? []).map((row) => {
    const r = fixNetPL(row);
    r.id = r.eventId ?? '__none__';
    r.name = r.eventName ?? 'Walk-in';
    delete r.eventId;
    delete r.eventName;
    return r;
  });
}

/**
 * Month-by-month P&L for an org. Server-side equivalent of repeatedly calling
 * computeMonthlyPL(...) for every month in the dataset. Returns an array of
 * { month, txCount, cardBuyQty, cardSellQty, sealedBuyQty, sealedSellQty, revenue, purchases,
 *   openingStock, closingStock, grossProfit, miscCosts, fixedCosts, netPL }.
 */
export async function loadMonthlyPL(orgId) {
  const { data, error } = await supabase.rpc('get_org_monthly_pl', { p_org_id: orgId });
  if (error) throw error;
  return (toCamel(data ?? [])).map(fixNetPL);
}

/**
 * Per-key stock aggregates (cards + sealed) for an org. Server-side equivalent
 * of buildStockMap(transactions) — only returns items with net qty > 0. Pass
 * { eventId: '__none__' } for walk-in transactions only, an event UUID to scope
 * to that event, or omit for global stock.
 * Returns rows: { type, key, name, number, setName, lang, imageUrl,
 *                 qtyIn, qtyOut, costIn, marketIn }.
 */
export async function loadStock(orgId, { eventId } = {}) {
  const params = { p_org_id: orgId };
  if (eventId === '__none__') params.p_filter_walk_ins = true;
  else if (eventId) params.p_event_id = eventId;

  const { data, error } = await supabase.rpc('get_org_stock', params);
  if (error) throw error;
  return toCamel(data ?? []);
}

// ─── Transactions ─────────────────────────────────────────────────────────────

/**
 * Paginated transaction header list for the History page. Filters, sort, and
 * pagination run server-side via the get_org_transactions_page RPC — the
 * client never holds the full transactions array. Pass null for any filter to
 * disable it; eventId '__none__' maps to the walk-in-only filter.
 *
 * Returns { rows, totalCount }. Each row carries the parent tx fields and
 * precomputed scalar aggregates the collapsed History row needs — but NOT
 * the underlying transaction_lines array. Use loadTransactionLines(orgId, txId)
 * to lazy-load lines for the expanded view.
 *
 * Row shape (camelCase): id, createdAt, notes, paymentMethod, event,
 *   createdBy, txType, inTotal, outTotal, cardInTotal, cardOutTotal,
 *   cardInQty, cardOutQty, hasCashIn, hasCashOut, cardSoldTotal,
 *   grossProfit, profitComplete.
 */
export async function loadTransactionsPage(orgId, {
  eventId = null,
  type = null,             // 'BUY' | 'SELL' | 'TRADE'
  creatorName = null,
  paymentMethod = null,
  sort = 'date',           // 'date' | 'total' | 'unit'
  offset = 0,
  limit = 20,
} = {}) {
  const params = {
    p_org_id:          orgId,
    p_event_id:        eventId === '__none__' ? null : eventId,
    p_filter_walk_ins: eventId === '__none__',
    p_type:            type,
    p_creator_name:    creatorName,
    p_payment_method:  paymentMethod,
    p_sort:            sort,
    p_offset:          offset,
    p_limit:           limit,
  };
  const { data, error } = await supabase.rpc('get_org_transactions_page', params);
  if (error) throw error;
  const payload = toCamel(data ?? { rows: [], total_count: 0 });
  return { rows: payload.rows ?? [], totalCount: payload.totalCount ?? 0 };
}

/**
 * Lazy-load the transaction_lines array for one transaction. Powers
 * TransactionCard's expand interaction — the slim page RPC omits lines so
 * collapsed rows render without shipping unused jsonb. Validates org
 * ownership server-side.
 */
export async function loadTransactionLines(orgId, txId) {
  const { data, error } = await supabase.rpc('get_transaction_full', {
    p_org_id: orgId,
    p_tx_id:  txId,
  });
  if (error) throw error;
  return toCamel(data ?? []);
}

/**
 * All transactions (with lines) in the given UTC calendar month for an org.
 * Powers the Export P&L modal on the Dashboard, which writes per-line CSV rows.
 * `ym` is a 'YYYY-MM' string matching JS's `tx.createdAt.slice(0, 7)`.
 */
export async function loadTransactionsForMonth(orgId, ym) {
  const { data, error } = await supabase.rpc('get_org_transactions_for_month', {
    p_org_id:     orgId,
    p_year_month: ym,
  });
  if (error) throw error;
  return toCamel(data ?? []);
}

/**
 * Distinct creator display names + payment methods present in the org's
 * non-deleted transactions. Powers the History filter dropdowns. Also returns
 * `hasAny` so History can distinguish empty-org from filtered-empty.
 */
export async function loadHistoryFilterOptions(orgId) {
  const { data, error } = await supabase.rpc('get_org_history_filter_options', { p_org_id: orgId });
  if (error) throw error;
  const payload = toCamel(data ?? {});
  return {
    creators:       payload.creators       ?? [],
    paymentMethods: payload.paymentMethods ?? [],
    hasAny:         payload.hasAny         ?? false,
  };
}

export async function saveTransaction({ orgId, createdById, notes, eventId, paymentMethod }) {
  const { data, error } = await supabase
    .from('transaction')
    .insert({
      org_id:         orgId,
      created_by_id:  createdById,
      notes:          notes ?? null,
      event_id:       eventId ?? null,
      payment_method: paymentMethod ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function saveTransactionLine(vars) {
  const row = toSnakeObj(vars);
  const { data, error } = await supabase.from('transaction_lines').insert(row).select('id').single();
  if (error) throw error;
  return data.id;
}

/**
 * Bulk-insert transaction lines for an existing transaction. Each `lines` entry
 * uses the same camelCase shape as `saveTransactionLine` (minus transactionId,
 * which is server-set from txId). Powers ImportModal's confirm step so a
 * 500-line CSV becomes one RPC instead of 500 INSERTs.
 */
export async function importTransactionLinesBulk(orgId, txId, lines) {
  if (!lines.length) return [];
  const { data, error } = await supabase.rpc('bulk_upsert_transaction_lines', {
    p_org_id:         orgId,
    p_transaction_id: txId,
    p_lines:          toSnakeObj(lines),
  });
  if (error) throw error;
  return data ?? [];
}

export async function deleteTransaction({ txId, deletedById }) {
  const { error } = await supabase
    .from('transaction')
    .update({ deleted_at: new Date().toISOString(), deleted_by_id: deletedById })
    .eq('id', txId);
  if (error) throw error;
}

export async function updateTransactionNotes({ txId, notes }) {
  const { error } = await supabase
    .from('transaction')
    .update({ notes: notes ?? null })
    .eq('id', txId);
  if (error) throw error;
}

export async function updateTransactionEvent({ txId, eventId }) {
  const { error } = await supabase
    .from('transaction')
    .update({ event_id: eventId ?? null })
    .eq('id', txId);
  if (error) throw error;
}

export async function updateTransactionPaymentMethod({ txId, paymentMethod }) {
  const { error } = await supabase
    .from('transaction')
    .update({ payment_method: paymentMethod ?? null })
    .eq('id', txId);
  if (error) throw error;
}

// ─── Payment methods ──────────────────────────────────────────────────────────

export async function loadPaymentMethods(orgId) {
  const { data, error } = await supabase
    .from('payment_method')
    .select('id, name, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function createPaymentMethod({ orgId, name }) {
  const { data, error } = await supabase
    .from('payment_method')
    .insert({ org_id: orgId, name })
    .select('id, name, created_at')
    .single();
  if (error) throw error;
  return toCamel(data);
}

export async function deletePaymentMethod(id) {
  const { error } = await supabase
    .from('payment_method')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function updateTransactionLine({ lineId, unitPriceMyr, qty }) {
  const updates = {};
  if (unitPriceMyr !== undefined) updates.unit_price_myr = unitPriceMyr;
  if (qty !== undefined) updates.qty = qty;
  const { error } = await supabase
    .from('transaction_lines')
    .update(updates)
    .eq('id', lineId);
  if (error) throw error;
}

/**
 * Bulk-update transaction lines (price / qty). Each entry is
 * { lineId, unitPriceMyr?, qty? } — only changed fields included. Validates
 * server-side that every line's parent tx belongs to orgId; raises if any
 * id is cross-org, stale, or under a soft-deleted tx.
 */
export async function updateTransactionLinesBulk(orgId, lines) {
  if (!lines.length) return [];
  const payload = lines.map(({ lineId, ...patch }) => ({ id: lineId, ...patch }));
  const { data, error } = await supabase.rpc('update_transaction_lines_bulk', {
    p_org_id: orgId,
    p_lines:  toSnakeObj(payload),
  });
  if (error) throw error;
  return data ?? [];
}

export async function deleteTransactionLine(lineId) {
  const { error } = await supabase
    .from('transaction_lines')
    .delete()
    .eq('id', lineId);
  if (error) throw error;
}

/**
 * Replay a card's transaction lines in chronological order (AVCO) and rewrite
 * avg_cost_myr on every downstream sale line. Pass null for cardExternalId to
 * recalculate every card in the org.
 */
export async function recalculateAvgCosts(orgId, cardExternalId = null) {
  const { error } = await supabase.rpc('recalculate_avg_costs', {
    p_org_id:           orgId,
    p_card_external_id: cardExternalId,
  });
  if (error) throw error;
}

// ─── Price cache ─────────────────────────────────────────────────────────────

export async function getCachedPrices(cardIds) {
  if (!cardIds.length) return new Map();
  const CHUNK = 50;
  const result = new Map();
  for (let i = 0; i < cardIds.length; i += CHUNK) {
    const chunk = cardIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('card_price_cache')
      .select('card_external_id, price_myr, price_source, fetched_at, price_updated_at')
      .in('card_external_id', chunk);
    if (error) throw error;
    for (const r of data ?? []) {
      result.set(r.card_external_id, {
        priceMyr:       r.price_myr,
        priceSource:    r.price_source,
        fetchedAt:      new Date(r.fetched_at),
        priceUpdatedAt: r.price_updated_at ? new Date(r.price_updated_at) : null,
      });
    }
  }
  return result;
}

export async function upsertCachedPrices(entries) {
  if (!entries.length) return;
  const { error } = await supabase
    .from('card_price_cache')
    .upsert(entries, { onConflict: 'card_external_id' });
  if (error) throw error;
}

export async function claimStaleCards(cardIds, force = false) {
  if (!cardIds.length) return [];
  const { data, error } = await supabase.rpc('claim_stale_cards', {
    p_card_ids: cardIds,
    p_force:    force,
  });
  if (error) throw error;
  return data ?? [];
}

// ─── Events ───────────────────────────────────────────────────────────────────

export async function loadEvents(orgId) {
  try {
    const { data, error } = await supabase
      .from('event')
      .select('id, name, location, starts_at, ends_at')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('starts_at', { ascending: false });

    if (error) throw error;
    return toCamel(data ?? []);
  } catch (err) {
    console.error('loadEvents error:', err);
    return [];
  }
}

export async function createEvent({ orgId, name, location, startsAt, endsAt, createdById }) {
  const { data, error } = await supabase
    .from('event')
    .insert({ org_id: orgId, name, location: location ?? null, starts_at: startsAt ?? null, ends_at: endsAt ?? null, created_by_id: createdById })
    .select('id')
    .single();
  if (error) throw error;
  return toCamel(data);
}

export async function getOrCreateImportEvent({ orgId, createdById, existingEvents }) {
  const existing = existingEvents.find((e) => e.name === 'Import/Purchase');
  if (existing) return existing;
  const { data, error } = await supabase
    .from('event')
    .insert({ org_id: orgId, name: 'Import/Purchase', created_by_id: createdById })
    .select('id, name, location, starts_at, ends_at')
    .single();
  if (error) throw error;
  return toCamel(data);
}

export async function updateEvent({ eventId, name, location, startsAt, endsAt }) {
  const { error } = await supabase
    .from('event')
    .update({ name, location: location ?? null, starts_at: startsAt ?? null, ends_at: endsAt ?? null })
    .eq('id', eventId);
  if (error) throw error;
}

export async function deleteEvent(eventId) {
  const { error } = await supabase
    .from('event')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', eventId);
  if (error) throw error;
}

// ─── Team / members ───────────────────────────────────────────────────────────

export async function getOrgMembers({ orgId }) {
  const { data, error } = await supabase
    .from('organization_members')
    .select('id, role, joined_at, user:user!user_id(id, uid, display_name, email)')
    .eq('org_id', orgId);
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function getOrgInvites({ orgId }) {
  const { data, error } = await supabase
    .from('invite')
    .select('id, email, role, token, created_at, expires_at, accepted_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function createInvite({ orgId, email, role, invitedById, expiresAt }) {
  const { data, error } = await supabase
    .from('invite')
    .insert({ org_id: orgId, email, role, invited_by_id: invitedById, expires_at: expiresAt })
    .select('id')
    .single();
  if (error) throw error;
  return toCamel(data);
}

export async function regenerateInvite({ inviteId, invitedById }) {
  const { data: old, error: fetchErr } = await supabase
    .from('invite')
    .select('org_id, email, role')
    .eq('id', inviteId)
    .single();
  if (fetchErr) throw fetchErr;

  const { error: delErr } = await supabase.from('invite').delete().eq('id', inviteId);
  if (delErr) throw delErr;

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('invite')
    .insert({ org_id: old.org_id, email: old.email, role: old.role, invited_by_id: invitedById, expires_at: expiresAt })
    .select('id')
    .single();
  if (error) throw error;
  return toCamel(data);
}

export async function acceptInvite(inviteId) {
  const { error } = await supabase
    .from('invite')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', inviteId);
  if (error) throw error;
}

export async function findPendingInviteByEmail(email) {
  const { data } = await supabase
    .from('invite')
    .select('id, org_id, role')
    .eq('email', email.toLowerCase())
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1);
  return toCamel(data?.[0] ?? null);
}

export async function hasPendingOrgInvite({ orgId, email }) {
  const { data } = await supabase
    .from('invite')
    .select('id')
    .eq('org_id', orgId)
    .eq('email', email.toLowerCase())
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export async function isEmailAlreadyOrgMember({ orgId, email }) {
  const { data: u } = await supabase
    .from('user')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (!u) return false;

  const { data: m } = await supabase
    .from('organization_members')
    .select('id')
    .eq('org_id', orgId)
    .eq('user_id', u.id)
    .maybeSingle();
  return !!m;
}

export async function addOrgMember({ orgId, userId, role }) {
  const { error } = await supabase
    .from('organization_members')
    .insert({ org_id: orgId, user_id: userId, role });
  if (error) throw error;
}

export async function deleteOrgMember({ memberId }) {
  const { error } = await supabase
    .from('organization_members')
    .delete()
    .eq('id', memberId);
  if (error) throw error;
}

export async function updateInviteEmail({ inviteId, email }) {
  const { error } = await supabase
    .from('invite')
    .update({ email: email.toLowerCase() })
    .eq('id', inviteId);
  if (error) throw error;
}

export async function deleteInvite({ inviteId }) {
  const { error } = await supabase
    .from('invite')
    .delete()
    .eq('id', inviteId);
  if (error) throw error;
}

// ─── Fund entries ─────────────────────────────────────────────────────────────

export async function loadFunds(orgId) {
  const { data, error } = await supabase
    .from('fund_entry')
    .select('id, amount_myr, note, created_at, created_by:user!created_by_id(display_name)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function createFundEntry({ orgId, amountMyr, note, createdById }) {
  const { data, error } = await supabase
    .from('fund_entry')
    .insert({ org_id: orgId, amount_myr: amountMyr, note: note ?? null, created_by_id: createdById })
    .select('id, amount_myr, note, created_at')
    .single();
  if (error) throw error;
  return toCamel(data);
}

export async function updateFundEntry({ id, amountMyr, note }) {
  const patch = { amount_myr: amountMyr };
  if (note !== undefined) patch.note = note;
  const { error } = await supabase
    .from('fund_entry')
    .update(patch)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteFundEntry(id) {
  const { error } = await supabase
    .from('fund_entry')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ─── Event misc costs ─────────────────────────────────────────────────────────

export async function loadEventMiscCosts(orgId) {
  try {
    const { data, error } = await supabase
      .from('event_misc_cost')
      .select('id, event_id, label, amount_myr, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return toCamel(data ?? []);
  } catch (err) {
    console.error('loadEventMiscCosts error:', err);
    return [];
  }
}

export async function createEventMiscCost({ orgId, eventId, label, amountMyr, createdById }) {
  const { data, error } = await supabase
    .from('event_misc_cost')
    .insert({ org_id: orgId, event_id: eventId, label, amount_myr: amountMyr, created_by_id: createdById ?? null })
    .select('id, event_id, label, amount_myr, created_at')
    .single();
  if (error) throw error;
  return toCamel(data);
}

export async function updateEventMiscCost({ id, label, amountMyr }) {
  const updates = {};
  if (label     !== undefined) updates.label      = label;
  if (amountMyr !== undefined) updates.amount_myr = amountMyr;
  const { error } = await supabase
    .from('event_misc_cost')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteEventMiscCost(id) {
  const { error } = await supabase
    .from('event_misc_cost')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ─── Fixed costs ──────────────────────────────────────────────────────────────

export async function loadFixedCosts(orgId) {
  try {
    const { data, error } = await supabase
      .from('fixed_cost')
      .select('id, label, amount_myr, month, created_at')
      .eq('org_id', orgId)
      .order('month', { ascending: false });
    if (error) throw error;
    return toCamel(data ?? []);
  } catch (err) {
    console.error('loadFixedCosts error:', err);
    return [];
  }
}

export async function createFixedCost({ orgId, label, amountMyr, month, createdById }) {
  const { data, error } = await supabase
    .from('fixed_cost')
    .insert({ org_id: orgId, label, amount_myr: amountMyr, month, created_by_id: createdById ?? null })
    .select('id, label, amount_myr, month, created_at')
    .single();
  if (error) throw error;
  return toCamel(data);
}

export async function updateFixedCost({ id, label, amountMyr }) {
  const updates = {};
  if (label     !== undefined) updates.label      = label;
  if (amountMyr !== undefined) updates.amount_myr = amountMyr;
  const { error } = await supabase
    .from('fixed_cost')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteFixedCost(id) {
  const { error } = await supabase
    .from('fixed_cost')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ─── Sealed products ──────────────────────────────────────────────────────────

const SEALED_COLS = 'id, name, reference_cost_myr, recommended_retail_price_myr, external_id, image_url, created_at';

export async function loadSealedProducts(orgId) {
  const { data, error } = await supabase
    .from('sealed_product')
    .select(SEALED_COLS)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('name', { ascending: true });
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function createSealedProduct({ orgId, name, referenceCostMyr, recommendedRetailPriceMyr, createdById }) {
  const { data, error } = await supabase
    .from('sealed_product')
    .insert({
      org_id:                       orgId,
      name,
      reference_cost_myr:           referenceCostMyr ?? null,
      recommended_retail_price_myr: recommendedRetailPriceMyr ?? null,
      created_by_id:                createdById,
    })
    .select(SEALED_COLS)
    .single();
  if (error) throw error;
  return toCamel(data);
}

export async function updateSealedProduct({ id, name, recommendedRetailPriceMyr }) {
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (recommendedRetailPriceMyr !== undefined) patch.recommended_retail_price_myr = recommendedRetailPriceMyr;

  const { data, error } = await supabase
    .from('sealed_product')
    .update(patch)
    .eq('id', id)
    .select(SEALED_COLS)
    .single();
  if (error) throw error;
  if (name !== undefined) {
    await supabase.from('transaction_lines').update({ sealed_name: name }).eq('sealed_catalog_id', id);
  }
  return toCamel(data);
}

export async function deleteSealedProduct(id) {
  const { error } = await supabase
    .from('sealed_product')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export async function getAllOrganizations() {
  const { data, error } = await supabase
    .from('organization')
    .select('id, name, slug, member_limit, created_at, deleted_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function updateOrgMemberLimit({ orgId, memberLimit }) {
  const { error } = await supabase
    .from('organization')
    .update({ member_limit: memberLimit })
    .eq('id', orgId);
  if (error) throw error;
}

export async function getAllUsers() {
  const { data, error } = await supabase
    .from('user')
    .select('id, uid, display_name, email, created_at, organization_members(role, org:organization!org_id(id, name))')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function createOrganization({ name, slug }) {
  const { data, error } = await supabase
    .from('organization')
    .insert({ name, slug })
    .select('id')
    .single();
  if (error) throw error;
  const org = toCamel(data);
  await supabase.from('payment_method').insert({ org_id: org.id, name: 'Cash' });
  return org;
}
