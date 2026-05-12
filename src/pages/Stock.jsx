import { useMemo, useState } from 'react';
import {
  Box, ScrollArea, Stack, Group, Text, Badge,
  TextInput, Select, Image, Center, ThemeIcon, Button,
} from '@mantine/core';
import { IconSearch, IconPackage, IconUpload } from '@tabler/icons-react';
import { computeStockItems } from '../lib/analytics';
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
  const [importOpen,  setImportOpen]  = useState(false);

  const canImport = role === 'owner' || role === 'admin';

  const allItems = useMemo(() => computeStockItems(transactions), [transactions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = q
      ? allItems.filter((item) =>
          item.name.toLowerCase().includes(q) ||
          (item.setName  ?? '').toLowerCase().includes(q) ||
          (item.number   ?? '').toLowerCase().includes(q)
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
          </Group>

          {/* Summary */}
          {allItems.length > 0 && (
            <Text size="xs" c="dimmed">
              {allItems.length} unique item{allItems.length !== 1 ? 's' : ''} · {totalUnits} total unit{totalUnits !== 1 ? 's' : ''}
            </Text>
          )}

          {/* List */}
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
          ) : (
            <Stack gap="sm">
              {filtered.map((item) => (
                <StockRow key={item.key} item={item} />
              ))}
            </Stack>
          )}

        </Stack>
      </ScrollArea>

      <ImportModal opened={importOpen} onClose={() => setImportOpen(false)} />
    </Box>
  );
}
