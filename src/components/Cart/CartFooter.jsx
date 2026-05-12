import { Paper, Stack, Group, Text, Divider, Button, ThemeIcon } from '@mantine/core';
import { IconCheck, IconAlertCircle } from '@tabler/icons-react';

export default function CartFooter({ inTotal, outTotal, onSave, saving, hasLines }) {
  const diff     = Math.abs(inTotal - outTotal);
  const balanced = diff < 0.01;
  const canSave  = balanced && hasLines;

  return (
    <Paper
      radius={0}
      p="md"
      style={{
        borderTop:  '1px solid var(--mantine-color-dark-5)',
        background: 'var(--mantine-color-dark-8)',
        flexShrink: 0,
      }}
    >
      <Stack gap="xs">

        <Group justify="space-between">
          <Text size="xs" c="dimmed">In</Text>
          <Text size="xs" fw={500}>RM {inTotal.toFixed(2)}</Text>
        </Group>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Out</Text>
          <Text size="xs" fw={500}>RM {outTotal.toFixed(2)}</Text>
        </Group>

        <Divider />

        {balanced && hasLines ? (
          <Group gap="xs">
            <ThemeIcon color="green" variant="light" size="sm" radius="xl">
              <IconCheck size={12} />
            </ThemeIcon>
            <Text size="sm" c="green.4" fw={500}>Balanced</Text>
          </Group>
        ) : (
          <Group gap="xs">
            <ThemeIcon color={hasLines ? 'red' : 'gray'} variant="light" size="sm" radius="xl">
              <IconAlertCircle size={12} />
            </ThemeIcon>
            <Text size="sm" c={hasLines ? 'red.4' : 'dimmed'}>
              {!hasLines
                ? 'Add items to the cart'
                : `RM ${diff.toFixed(2)} off`}
            </Text>
          </Group>
        )}

        <Button
          fullWidth
          size="md"
          color="violet"
          disabled={!canSave}
          loading={saving}
          onClick={onSave}
        >
          Save Transaction
        </Button>

      </Stack>
    </Paper>
  );
}
