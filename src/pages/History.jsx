import { useState } from 'react';
import {
  Box, ScrollArea, Stack, Text, Center, ThemeIcon,
  Group, ActionIcon,
} from '@mantine/core';
import { IconHistory, IconLayoutList, IconLayoutGrid } from '@tabler/icons-react';
import useOrgStore from '../store/orgStore';
import TransactionCard from '../components/History/TransactionCard';

export default function History() {
  const transactions = useOrgStore((s) => s.transactions);
  const [view, setViewRaw] = useState(() => localStorage.getItem('history_view') ?? 'list');

  function setView(v) {
    setViewRaw(v);
    localStorage.setItem('history_view', v);
  }

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
            {transactions.map((tx) => (
              <TransactionCard key={tx.id} tx={tx} view={view} />
            ))}
          </Stack>

        </Stack>
      </ScrollArea>
    </Box>
  );
}
