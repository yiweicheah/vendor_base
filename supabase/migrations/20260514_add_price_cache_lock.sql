alter table card_price_cache
  add column if not exists locked_until     timestamptz,
  add column if not exists price_updated_at timestamptz;

create or replace function claim_stale_cards(
  p_card_ids text[],
  p_force    boolean default false
) returns text[]
language plpgsql security definer as $$
declare
  v_lock_until   timestamptz := now() + interval '30 seconds';
  v_stale_before timestamptz := now() - interval '26 hours';
  v_claimed      text[];
begin
  -- Claim existing stale rows not already locked by another session
  with claimed as (
    update card_price_cache
       set locked_until = v_lock_until
     where card_external_id = any(p_card_ids)
       and (p_force or price_updated_at is null or price_updated_at < v_stale_before)
       and (locked_until is null or locked_until < now())
    returning card_external_id
  )
  select coalesce(array_agg(card_external_id), array[]::text[])
    into v_claimed from claimed;

  -- Insert placeholder rows for cards not yet in the table
  -- ON CONFLICT DO NOTHING means only one session wins for brand-new cards
  with inserted as (
    insert into card_price_cache (card_external_id, fetched_at, locked_until)
    select t.id, '1970-01-01'::timestamptz, v_lock_until
    from   unnest(p_card_ids) as t(id)
    where  not exists (
      select 1 from card_price_cache c where c.card_external_id = t.id
    )
    on conflict (card_external_id) do nothing
    returning card_external_id
  )
  select v_claimed || coalesce(array_agg(card_external_id), array[]::text[])
    into v_claimed from inserted;

  return coalesce(v_claimed, array[]::text[]);
end;
$$;

grant execute on function claim_stale_cards(text[], boolean) to authenticated;
