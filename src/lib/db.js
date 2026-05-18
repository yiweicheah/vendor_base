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
 * Returns [{ org: { id, name, slug }, role }].
 */
export async function loadAllMemberships(dbUserId) {
  try {
    const { data, error } = await supabase
      .from('organization_members')
      .select('role, org:organization!org_id(id, name, slug)')
      .eq('user_id', dbUserId);
    if (error) throw error;
    return (data ?? []).map((m) => ({ org: toCamel(m.org), role: m.role }));
  } catch (err) {
    console.error('loadAllMemberships error:', err);
    return [];
  }
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export async function loadTransactions(orgId) {
  try {
    const { data, error } = await supabase
      .from('transaction')
      .select(`
        id,
        created_at,
        notes,
        created_by:user!created_by_id(display_name),
        event:event!event_id(id, name),
        transaction_lines(
          id, side, type,
          card_external_id, card_name, card_number, card_set_name, card_lang, card_image_url,
          avg_cost_myr,
          market_price_myr, price_source,
          sealed_name, sealed_reference_price,
          qty, unit_price_myr
        )
      `)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;
    return toCamel(data ?? []);
  } catch (err) {
    console.error('loadTransactions error:', err);
    return [];
  }
}

export async function saveTransaction({ orgId, createdById, notes, eventId }) {
  const { data, error } = await supabase
    .from('transaction')
    .insert({ org_id: orgId, created_by_id: createdById, notes: notes ?? null, event_id: eventId ?? null })
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

export async function deleteTransactionLine(lineId) {
  const { error } = await supabase
    .from('transaction_lines')
    .delete()
    .eq('id', lineId);
  if (error) throw error;
}

// ─── Price cache ─────────────────────────────────────────────────────────────

export async function getCachedPrices(cardIds) {
  if (!cardIds.length) return new Map();
  const { data, error } = await supabase
    .from('card_price_cache')
    .select('card_external_id, price_myr, price_source, fetched_at, price_updated_at')
    .in('card_external_id', cardIds);
  if (error) throw error;
  return new Map(
    (data ?? []).map((r) => [
      r.card_external_id,
      {
        priceMyr:       r.price_myr,
        priceSource:    r.price_source,
        fetchedAt:      new Date(r.fetched_at),
        priceUpdatedAt: r.price_updated_at ? new Date(r.price_updated_at) : null,
      },
    ])
  );
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

export async function updateEvent({ eventId, name, location, startsAt, endsAt }) {
  const { error } = await supabase
    .from('event')
    .update({ name, location: location ?? null, starts_at: startsAt ?? null, ends_at: endsAt ?? null })
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

export async function updateFundEntry({ id, amountMyr }) {
  const { error } = await supabase
    .from('fund_entry')
    .update({ amount_myr: amountMyr })
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

// ─── Admin ────────────────────────────────────────────────────────────────────

export async function getAllOrganizations() {
  const { data, error } = await supabase
    .from('organization')
    .select('id, name, slug, created_at, deleted_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return toCamel(data ?? []);
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
  return toCamel(data);
}
