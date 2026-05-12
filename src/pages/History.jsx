import { Box, ScrollArea, Stack, Text, Center, ThemeIcon } from '@mantine/core';
import { IconHistory } from '@tabler/icons-react';
import useOrgStore from '../store/orgStore';
import TransactionCard from '../components/History/TransactionCard';

export default function History() {
  const transactions = useOrgStore((s) => s.transactions);

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
          {transactions.map((tx) => (
            <TransactionCard key={tx.id} tx={tx} />
          ))}
        </Stack>
      </ScrollArea>
    </Box>
  );
}
