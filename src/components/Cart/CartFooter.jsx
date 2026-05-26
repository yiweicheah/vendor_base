import { Paper, Stack, Group, Text, Divider, Button, ThemeIcon, Select } from '@mantine/core';
import { IconCheck, IconAlertCircle } from '@tabler/icons-react';
import useOrgStore from '../../store/orgStore';
import { rm } from '../../lib/format';

export default function CartFooter({ inTotal, outTotal, onSave, saving, hasLines, hasCashIn, paymentMethod, onPaymentMethodChange }) {
  const diff              = Math.abs(inTotal - outTotal);
  const balanced          = diff < 0.01;
  const paymentMethods    = useOrgStore((s) => s.paymentMethods);
  const noMethodsSetUp    = paymentMethods.length === 0;
  const needsPaymentMethod = hasCashIn && !noMethodsSetUp && !paymentMethod;
  const canSave           = balanced && hasLines && !needsPaymentMethod && !noMethodsSetUp;

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
          <Text size="xs" fw={500}>{rm(inTotal)}</Text>
        </Group>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Out</Text>
          <Text size="xs" fw={500}>{rm(outTotal)}</Text>
        </Group>

        <Divider />

        {noMethodsSetUp ? (
          <Group gap="xs">
            <ThemeIcon color="orange" variant="light" size="sm" radius="xl">
              <IconAlertCircle size={12} />
            </ThemeIcon>
            <Text size="sm" c="orange.4">Add a payment method in Team settings first</Text>
          </Group>
        ) : balanced && hasLines && !needsPaymentMethod ? (
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
                : needsPaymentMethod
                ? 'Select a payment method'
                : `${rm(diff)} off`}
            </Text>
          </Group>
        )}

        {paymentMethods.length > 0 && (
          <Select
            placeholder="Payment method"
            data={paymentMethods.map((m) => ({ value: m.name, label: m.name }))}
            value={paymentMethod}
            onChange={onPaymentMethodChange}
            size="xs"
            clearable
            error={needsPaymentMethod}
          />
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
