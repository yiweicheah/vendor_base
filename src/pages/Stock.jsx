import { useMemo, useState } from 'react';
import {
  Box, ScrollArea, Stack, Group, Text, Badge,
  TextInput, Select, Image, Center, ThemeIcon, Button,
  ActionIcon, SimpleGrid,
} from '@mantine/core';
import { IconSearch, IconPackage, IconUpload, IconLayoutList, IconLayoutGrid } from '@tabler/icons-react';
import { computeStockItems } from '../lib/analytics';
import { normalizeStr } from '../lib/tokenizer';
import useOrgStore from '../store/orgStore';
import ImportModal from '../components/Stock/ImportModal';

function GainText({ value }) {
  if (!value) return null;
  const color = value > 0 ? 'green.4' : value < 0 ? 'red.4' : 'dimmed';
  const prefix = value > 0 ? '+' : '';
  return (
    <Text size="xs" c={color}>{prefix}RM {value.toFixed(2)}</Text>
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
        {isCard && <GainText value={item.unrealizedGain} />}
      </Stack>
    </Group>
  );
}

function StockGridItem({ item }) {
  const isCard = item.type === 'card';
  return (
    <Stack gap={6}>
      <Box style={{ width: '100%', position: 'relative' }}>
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
        <Text size="xs" c="dimmed">RM {item.avgCost.toFixed(2)}</Text>
        {isCard && <GainText value={item.unrealizedGain} />}
      </Stack>
    </Stack>
  );
}

const SORT_OPTIONS = [
  { value: 'name-asc',    label: 'Name (A–Z)' },
  { value: 'qty-desc',    label: 'Qty (high first)' },
  { value: 'market-desc', label: 'Market value' },
  { value: 'gain-desc',   label: 'Unrealized gain' },
];

function applySort(items, sort) {
  const sorted = [...items];
  switch (sort) {
    case 'qty-desc':    return sorted.sort((a, b) => b.qty - a.qty);
    case 'market-desc': return sorted.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
    case 'gain-desc':   return sorted.sort((a, b) => (b.unrealizedGain ?? 0) - (a.unrealizedGain ?? 0));
    default:            return sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
}

export default function Stock() {
  const transactions = useOrgStore((s) => s.transactions);
  const role         = useOrgStore((s) => s.role);
  const [query,       setQuery]       = useState('');
  const [sort,        setSort]        = useState('name-asc');
  const [eventFilter, setEventFilter] = useState('');
  const [importOpen,  setImportOpen]  = useState(false);
  const [view,        setViewRaw]     = useState(() => localStorage.getItem('stock_view') ?? 'list');

  function setView(v) {
    setViewRaw(v);
    localStorage.setItem('stock_view', v);
  }

  const canImport = role === 'owner' || role === 'admin';

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

  const allItems = useMemo(() => computeStockItems(scopedTxs), [scopedTxs]);

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

  const totalUnits = allItems.reduce((sum, i) => sum + i.qty, 0);

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <ScrollArea style={{ flex: 1 }} p="md">
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
              <Button
                variant="light"
                size="sm"
                leftSection={<IconUpload size={13} />}
                onClick={() => setImportOpen(true)}
              >
                Import
              </Button>
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
            <Text size="xs" c="dimmed">
              {allItems.length} unique item{allItems.length !== 1 ? 's' : ''} · {totalUnits} total unit{totalUnits !== 1 ? 's' : ''}
            </Text>
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
              {filtered.map((item) => (
                <StockRow key={item.key} item={item} />
              ))}
            </Stack>
          ) : (
            <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="sm">
              {filtered.map((item) => (
                <StockGridItem key={item.key} item={item} />
              ))}
            </SimpleGrid>
          )}

        </Stack>
      </ScrollArea>

      <ImportModal opened={importOpen} onClose={() => setImportOpen(false)} />
    </Box>
  );
}
