create table if not exists card_price_cache (
  card_external_id text      primary key,
  price_myr        numeric,
  price_source     text,
  fetched_at       timestamptz not null default now()
);

alter table card_price_cache enable row level security;

create policy "authenticated read"
  on card_price_cache for select
  using (auth.role() = 'authenticated');

create policy "authenticated insert"
  on card_price_cache for insert
  with check (auth.role() = 'authenticated');

create policy "authenticated update"
  on card_price_cache for update
  using (auth.role() = 'authenticated');
