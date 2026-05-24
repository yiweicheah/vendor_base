import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, ScrollArea, Stack, Group, Text, Badge,
  TextInput, Select, Image, Center, ThemeIcon, Button,
  ActionIcon, Pagination,
} from '@mantine/core';
import { IconSearch, IconPackage, IconUpload, IconLayoutList, IconLayoutGrid, IconRefresh, IconPlus } from '@tabler/icons-react';
import { computeStockItems } from '../lib/analytics';
import { normalizeStr } from '../lib/tokenizer';
import { refreshStaleCardPrices } from '../lib/priceRefresh';
import useOrgStore from '../store/orgStore';
import ImportModal from '../components/Stock/ImportModal';
import AddStockModal from '../components/Stock/AddStockModal';
import CardDetailModal from '../components/Cards/CardDetailModal';

function GainText({ value, costBasis }) {
  if (!value) return null;
  const color = value > 0 ? 'green.4' : value < 0 ? 'red.4' : 'dimmed';
  const prefix = value > 0 ? '+' : '';
  const pct = costBasis > 0 ? ` (${prefix}${((value / costBasis) * 100).toFixed(1)}%)` : '';
  return (
    <Text size="xs" c={color}>{prefix}RM {value.toFixed(2)}{pct}</Text>
  );
}

function StockRow({ item }) {
  const isCard = item.type === 'card';

  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      {/* Thumbnail / placeholder */}
      <Box style={{ flexShrink: 0 }}>
        {isCard && item.imageUrl ? (
          <Image src={item.imageUrl} w={28} h={39} radius="sm" fit="contain" />
        ) : (
          <Box
            w={28} h={39}
            bg="dark.6"
            style={{ borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {!isCard && <IconPackage size={14} color="var(--mantine-color-dark-2)" />}
          </Box>
        )}
      </Box>

      {/* Identity */}
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Group gap="xs" wrap="nowrap">
          <Text size="sm" fw={500} truncate>{item.name}</Text>
          {!isCard && (
            <Badge color="gray" variant="light" size="xs">SEALED</Badge>
          )}
        </Group>
        {isCard ? (
          <Text size="xs" c="dimmed" truncate>
            {[item.setName, item.number, item.lang].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        <Text size="xs" c="dimmed">Avg cost RM {item.avgCost.toFixed(2)}</Text>
      </Stack>

      {/* Right — qty + value */}
      <Stack gap={2} align="flex-end" style={{ flexShrink: 0 }}>
        <Badge color="violet" variant="light" size="sm">×{item.qty}</Badge>
        {isCard && item.marketValue > 0 && (
          <Text size="xs" c="dimmed">RM {item.marketValue.toFixed(2)}</Text>
        )}
        {isCard && <GainText value={item.unrealizedGain} costBasis={item.costBasis} />}
      </Stack>
    </Group>
  );
}

function StockGridItem({ item, onCardClick }) {
  const isCard = item.type === 'card';
  return (
    <Stack gap={6}>
      <Box
        style={{ width: '100%', position: 'relative', cursor: isCard ? 'pointer' : 'default' }}
        onClick={isCard ? () => onCardClick(item.key, item.imageUrl) : undefined}
      >
        {isCard && item.imageUrl ? (
          <Image
            src={item.imageUrl}
            fit="contain"
            style={{ aspectRatio: '245/337', width: '100%', borderRadius: '4.4%', overflow: 'hidden' }}
          />
        ) : (
          <Box
            bg="dark.6"
            style={{
              aspectRatio: '245/337',
              borderRadius: '4.4%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconPackage size={24} color="var(--mantine-color-dark-2)" />
          </Box>
        )}
        <Badge
          style={{ position: 'absolute', top: 4, right: 4 }}
          color="violet"
          variant="filled"
          size="xs"
        >
          ×{item.qty}
        </Badge>
      </Box>
      <Stack gap={2}>
        <Text size="xs" fw={500} lineClamp={2}>{item.name}</Text>
        <Text size="xs" c="dimmed">Cost RM {item.avgCost.toFixed(2)}</Text>
        {isCard && item.avgMarket > 0 && (
          <Text size="xs" c="dimmed">Mkt RM {item.avgMarket.toFixed(2)}</Text>
        )}
        {isCard && <GainText value={item.unrealizedGain} costBasis={item.costBasis} />}
      </Stack>
    </Stack>
  );
}

const PAGE_SIZE_GRID = 24;
const PAGE_SIZE_LIST = 40;

const SORT_OPTIONS = [
  { value: 'name-asc',       label: 'Name (A–Z)' },
  { value: 'qty-desc',       label: 'Qty (high first)' },
  { value: 'unit-desc',      label: 'Unit price' },
  { value: 'market-desc',    label: 'Total market value' },
  { value: 'gain-desc',      label: 'Unrealized gain' },
];

function applySort(items, sort) {
  const sorted = [...items];
  switch (sort) {
    case 'qty-desc':    return sorted.sort((a, b) => b.qty - a.qty);
    case 'unit-desc':   return sorted.sort((a, b) => (b.avgMarket ?? 0) - (a.avgMarket ?? 0));
    case 'market-desc': return sorted.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
    case 'gain-desc':   return sorted.sort((a, b) => (b.unrealizedGain ?? 0) - (a.unrealizedGain ?? 0));
    default:            return sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
}

export default function Stock() {
  const transactions = useOrgStore((s) => s.transactions);
  const role         = useOrgStore((s) => s.role);
  const [query,          setQuery]          = useState('');
  const [sort,           setSort]           = useState('name-asc');
  const [eventFilter,    setEventFilter]    = useState('');
  const [importOpen,     setImportOpen]     = useState(false);
  const [addStockOpen,   setAddStockOpen]   = useState(false);
  const [detailCard,     setDetailCard]     = useState(null); // { id, imageUrl }
  const [page,           setPage]           = useState(1);
  const viewportRef = useRef(null);
  const [view,           setViewRaw]        = useState(() => localStorage.getItem('stock_view') ?? 'list');
  const [priceOverrides, setPriceOverrides] = useState(new Map());
  const [refreshing,     setRefreshing]     = useState(false);
  const [lastRefreshed,  setLastRefreshed]  = useState(null);

  function setView(v) {
    setViewRaw(v);
    localStorage.setItem('stock_view', v);
  }

  const canImport = role === 'owner' || role === 'admin';

  const cardIds = useMemo(() => {
    const ids = new Set();
    for (const tx of transactions) {
      for (const line of tx.transactionLines ?? []) {
        if (line.type === 'card' && line.cardExternalId) ids.add(String(line.cardExternalId));
      }
    }
    return [...ids];
  }, [transactions]);

  const cardIdsKey = useMemo(() => [...cardIds].sort().join(','), [cardIds]);

  const doRefresh = useCallback(async (force = false) => {
    if (!cardIds.length) return;
    setRefreshing(true);
    try {
      const map = await refreshStaleCardPrices(cardIds, force);
      setPriceOverrides(new Map(map));
      setLastRefreshed(new Date());
    } catch (err) {
      console.error('price refresh error:', err);
    } finally {
      setRefreshing(false);
    }
  }, [cardIds]);

  useEffect(() => {
    if (!cardIds.length) return;
    let cancelled = false;
    (async () => {
      setRefreshing(true);
      try {
        const map = await refreshStaleCardPrices(cardIds, false);
        if (!cancelled) { setPriceOverrides(new Map(map)); setLastRefreshed(new Date()); }
      } catch (err) {
        console.error('price refresh error:', err);
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();
    return () => { cancelled = true; };
  // cardIdsKey is the stable string representation of cardIds
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardIdsKey]);

  const eventOptions = useMemo(() => {
    const seen = new Map();
    for (const tx of transactions) {
      if (tx.event?.id) {
        seen.set(String(tx.event.id), tx.event.name ?? 'Unnamed');
      } else {
        seen.set('__none__', 'Walk-in');
      }
    }
    if (seen.size === 0) return [];
    return [
      { value: '', label: 'All events' },
      ...[...seen.entries()].map(([id, name]) => ({ value: id, label: name })),
    ];
  }, [transactions]);

  const scopedTxs = useMemo(() => {
    if (!eventFilter) return transactions;
    if (eventFilter === '__none__') return transactions.filter((tx) => !tx.event?.id);
    return transactions.filter((tx) => String(tx.event?.id) === eventFilter);
  }, [transactions, eventFilter]);

  const allItems = useMemo(() => computeStockItems(scopedTxs, priceOverrides), [scopedTxs, priceOverrides]);

  const filtered = useMemo(() => {
    const q = normalizeStr(query.trim().toLowerCase());
    const matching = q
      ? allItems.filter((item) =>
          normalizeStr(item.name.toLowerCase()).includes(q) ||
          normalizeStr((item.setName  ?? '').toLowerCase()).includes(q) ||
          normalizeStr((item.number   ?? '').toLowerCase()).includes(q)
        )
      : allItems;
    return applySort(matching, sort);
  }, [allItems, query, sort]);

  // Reset to page 1 whenever the filtered set or view changes
  useEffect(() => { setPage(1); }, [filtered, view]);

  const pageSize   = view === 'grid' ? PAGE_SIZE_GRID : PAGE_SIZE_LIST;
  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged      = filtered.slice((page - 1) * pageSize, page * pageSize);

  const totalUnits = allItems.reduce((sum, i) => sum + i.qty, 0);

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <ScrollArea style={{ flex: 1 }} p="md" viewportRef={viewportRef}>
        <Stack gap="md" pb="md">

          {/* Controls */}
          <Group gap="sm">
            <TextInput
              placeholder="Search cards…"
              leftSection={<IconSearch size={14} />}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              style={{ flex: 1 }}
              size="sm"
            />
            {eventOptions.length > 0 && (
              <Select
                data={eventOptions}
                value={eventFilter}
                onChange={(v) => setEventFilter(v ?? '')}
                size="sm"
                w={150}
                allowDeselect={false}
              />
            )}
            <Select
              data={SORT_OPTIONS}
              value={sort}
              onChange={(v) => setSort(v ?? 'name-asc')}
              size="sm"
              w={160}
              allowDeselect={false}
            />
            {canImport && (
              <>
                <Button
                  variant="light"
                  size="sm"
                  leftSection={<IconPlus size={13} />}
                  onClick={() => setAddStockOpen(true)}
                >
                  Add Stock
                </Button>
                <Button
                  variant="light"
                  size="sm"
                  leftSection={<IconUpload size={13} />}
                  onClick={() => setImportOpen(true)}
                >
                  Import
                </Button>
              </>
            )}
            <Group gap={4}>
              <ActionIcon
                variant={view === 'list' ? 'light' : 'subtle'}
                color={view === 'list' ? 'violet' : 'gray'}
                size="sm"
                onClick={() => setView('list')}
              >
                <IconLayoutList size={15} />
              </ActionIcon>
              <ActionIcon
                variant={view === 'grid' ? 'light' : 'subtle'}
                color={view === 'grid' ? 'violet' : 'gray'}
                size="sm"
                onClick={() => setView('grid')}
              >
                <IconLayoutGrid size={15} />
              </ActionIcon>
            </Group>
          </Group>

          {/* Summary */}
          {allItems.length > 0 && (
            <Group gap="xs" align="center">
              <Text size="xs" c="dimmed">
                {allItems.length} unique item{allItems.length !== 1 ? 's' : ''} · {totalUnits} total unit{totalUnits !== 1 ? 's' : ''}
              </Text>
              {lastRefreshed && (
                <Text size="xs" c="dimmed">
                  · prices {lastRefreshed.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: false })}
                </Text>
              )}
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                loading={refreshing}
                onClick={() => doRefresh(true)}
                title="Force refresh prices"
              >
                <IconRefresh size={11} />
              </ActionIcon>
            </Group>
          )}

          {/* List / Grid */}
          {filtered.length === 0 ? (
            query ? (
              <Text size="xs" c="dimmed">No matches.</Text>
            ) : (
              <Center py="xl">
                <Stack align="center" gap="xs">
                  <ThemeIcon color="dark" variant="light" size="xl" radius="xl">
                    <IconPackage size={20} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed">No stock on hand.</Text>
                </Stack>
              </Center>
            )
          ) : view === 'list' ? (
            <Stack gap="sm">
              {paged.map((item) => (
                <StockRow key={item.key} item={item} />
              ))}
            </Stack>
          ) : (
            <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--mantine-spacing-sm)' }}>
              {paged.map((item) => (
                <StockGridItem
                  key={item.key}
                  item={item}
                  onCardClick={(id, imageUrl) => setDetailCard({ id, imageUrl })}
                />
              ))}
            </Box>
          )}

          {totalPages > 1 && (
            <Pagination
              value={page}
              onChange={(p) => { setPage(p); viewportRef.current?.scrollTo({ top: 0 }); }}
              total={totalPages}
              size="sm"
              color="violet"
            />
          )}

        </Stack>
      </ScrollArea>

      <ImportModal opened={importOpen} onClose={() => setImportOpen(false)} />
      <AddStockModal opened={addStockOpen} onClose={() => setAddStockOpen(false)} />
      <CardDetailModal
        cardExternalId={detailCard?.id ?? null}
        fallbackImageUrl={detailCard?.imageUrl ?? null}
        onClose={() => setDetailCard(null)}
      />
    </Box>
  );
}
