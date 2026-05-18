import { useState, useMemo } from 'react';
import {
  Box, ScrollArea, Stack, Text, Center, ThemeIcon,
  Group, ActionIcon, Select,
} from '@mantine/core';

function formatEventDates(startsAt, endsAt) {
  if (!startsAt) return null;
  const fmt = (ts) => new Date(ts).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
  if (!endsAt) return fmt(startsAt);
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  return s.toDateString() === e.toDateString() ? fmt(startsAt) : `${fmt(startsAt)} – ${fmt(endsAt)}`;
}
import { IconHistory, IconLayoutList, IconLayoutGrid } from '@tabler/icons-react';
import useOrgStore from '../store/orgStore';
import TransactionCard from '../components/History/TransactionCard';

const SORT_OPTIONS = [
  { value: 'date',  label: 'Date' },
  { value: 'total', label: 'Total value' },
  { value: 'unit',  label: 'Unit price' },
];

function lineTotal(lines) {
  return lines.reduce((s, l) => s + (l.unitPriceMyr || 0) * l.qty, 0);
}

function maxUnitPrice(lines) {
  return lines.reduce((m, l) => Math.max(m, l.unitPriceMyr || 0), 0);
}


export default function History() {
  const transactions  = useOrgStore((s) => s.transactions);
  const events        = useOrgStore((s) => s.events);
  const [view, setViewRaw]          = useState(() => localStorage.getItem('history_view')         ?? 'list');
  const [sort, setSortRaw]          = useState(() => localStorage.getItem('history_sort')         ?? 'date');
  const [eventFilter, setFilterRaw] = useState(() => localStorage.getItem('history_event_filter') ?? 'all');
  const [eventSearch, setEventSearch] = useState('');

  function setView(v)        { setViewRaw(v);    localStorage.setItem('history_view', v); }
  function setSort(v)        { setSortRaw(v);    localStorage.setItem('history_sort', v); }
  function setEventFilter(v) { setFilterRaw(v);  localStorage.setItem('history_event_filter', v); }

  const eventOptions = useMemo(() => [
    { value: 'all',      label: 'All events' },
    { value: '__none__', label: 'Walk-ins' },
    ...events.map((e) => ({ value: e.id, label: e.name, startsAt: e.startsAt, endsAt: e.endsAt })),
  ], [events]);

  const sorted = useMemo(() => {
    const copy = [...transactions];
    if (sort === 'total') {
      copy.sort((a, b) => {
        const aLines = a.transactionLines ?? [];
        const bLines = b.transactionLines ?? [];
        return lineTotal(bLines) - lineTotal(aLines);
      });
    } else if (sort === 'unit') {
      copy.sort((a, b) => {
        const aLines = a.transactionLines ?? [];
        const bLines = b.transactionLines ?? [];
        return maxUnitPrice(bLines) - maxUnitPrice(aLines);
      });
    } else {
      copy.sort((a, b) => b.createdAt - a.createdAt);
    }
    return copy;
  }, [transactions, sort]);

  const displayed = useMemo(() => {
    if (eventFilter === 'all')      return sorted;
    if (eventFilter === '__none__') return sorted.filter((tx) => tx.event == null);
    return sorted.filter((tx) => tx.event?.id === eventFilter);
  }, [sorted, eventFilter]);


  if (transactions.length === 0) {
    return (
      <Center h="100%">
        <Stack align="center" gap="md">
          <ThemeIcon size={48} variant="light" color="violet">
            <IconHistory size={28} />
          </ThemeIcon>
          <Text c="dimmed" size="sm">No transactions yet</Text>
        </Stack>
      </Center>
    );
  }

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <ScrollArea style={{ flex: 1 }} p="md">
        <Stack gap="sm" pb="md">

          <Group justify="flex-end">
            {events.length > 0 && (
              <Select
                data={eventOptions}
                value={eventFilter}
                onChange={setEventFilter}
                size="xs"
                w={180}
                allowDeselect={false}
                searchable
                searchValue={eventSearch}
                onSearchChange={setEventSearch}
                onDropdownOpen={() => setEventSearch('')}
                renderOption={({ option }) => {
                  const date = option.startsAt
                    ? formatEventDates(option.startsAt, option.endsAt)
                    : null;
                  return (
                    <Stack gap={0}>
                      <Text size="xs">{option.label}</Text>
                      {date && <Text size="xs" c="dimmed">{date}</Text>}
                    </Stack>
                  );
                }}
              />
            )}
            <Select
              data={SORT_OPTIONS}
              value={sort}
              onChange={setSort}
              size="xs"
              w={120}
              allowDeselect={false}
            />
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

          {displayed.length === 0 ? (
            <Center py="xl">
              <Text c="dimmed" size="sm">No transactions for this filter</Text>
            </Center>
          ) : (
            <Stack gap="sm">
              {displayed.map((tx) => (
                <TransactionCard key={tx.id} tx={tx} view={view} />
              ))}
            </Stack>
          )}

        </Stack>
      </ScrollArea>
    </Box>
  );
}
