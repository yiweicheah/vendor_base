import { useState, useMemo } from 'react';
import {
  Box, ScrollArea, Stack, Text, Center, ThemeIcon,
  Group, ActionIcon, Select,
} from '@mantine/core';
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
  const transactions = useOrgStore((s) => s.transactions);
  const [view, setViewRaw] = useState(() => localStorage.getItem('history_view') ?? 'list');
  const [sort, setSortRaw] = useState(() => localStorage.getItem('history_sort') ?? 'date');

  function setView(v) {
    setViewRaw(v);
    localStorage.setItem('history_view', v);
  }

  function setSort(v) {
    setSortRaw(v);
    localStorage.setItem('history_sort', v);
  }

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

          <Stack gap="sm">
            {sorted.map((tx) => (
              <TransactionCard key={tx.id} tx={tx} view={view} />
            ))}
          </Stack>

        </Stack>
      </ScrollArea>
    </Box>
  );
}
