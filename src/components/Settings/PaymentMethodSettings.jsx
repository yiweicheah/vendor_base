import { useState } from 'react';
import {
  Stack, Group, Text, TextInput, Button, ActionIcon,
  Paper, Divider,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconTrash, IconPlus } from '@tabler/icons-react';
import { createPaymentMethod, deletePaymentMethod } from '../../lib/db';
import useOrgStore from '../../store/orgStore';

export default function PaymentMethodSettings() {
  const org            = useOrgStore((s) => s.org);
  const paymentMethods = useOrgStore((s) => s.paymentMethods);
  const addPaymentMethod    = useOrgStore((s) => s.addPaymentMethod);
  const removePaymentMethod = useOrgStore((s) => s.removePaymentMethod);

  const [name,    setName]    = useState('');
  const [adding,  setAdding]  = useState(false);
  const [deleting, setDeleting] = useState(null);

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed || !org?.id) return;
    if (paymentMethods.some((m) => m.name.toLowerCase() === trimmed.toLowerCase())) {
      notifications.show({ message: 'Already exists.', color: 'orange', autoClose: 2000 });
      return;
    }
    setAdding(true);
    try {
      const created = await createPaymentMethod({ orgId: org.id, name: trimmed });
      addPaymentMethod(created);
      setName('');
    } catch (err) {
      notifications.show({ title: 'Failed to add', message: err.message, color: 'red' });
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id) {
    setDeleting(id);
    try {
      await deletePaymentMethod(id);
      removePaymentMethod(id);
    } catch (err) {
      notifications.show({ title: 'Failed to delete', message: err.message, color: 'red' });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Stack gap="sm">
      <Text size="sm" fw={600}>Payment Methods</Text>

      {paymentMethods.length === 0 ? (
        <Text size="xs" c="dimmed">No payment methods yet.</Text>
      ) : (
        <Stack gap="xs">
          {paymentMethods.map((m) => (
            <Group key={m.id} justify="space-between" wrap="nowrap">
              <Text size="sm">{m.name}</Text>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="red"
                loading={deleting === m.id}
                onClick={() => handleDelete(m.id)}
              >
                <IconTrash size={13} />
              </ActionIcon>
            </Group>
          ))}
        </Stack>
      )}

      <Divider variant="dashed" />

      <Group gap="xs">
        <TextInput
          placeholder="e.g. Grab, MaybankQR"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          size="xs"
          style={{ flex: 1 }}
        />
        <Button
          size="xs"
          leftSection={<IconPlus size={12} />}
          loading={adding}
          disabled={!name.trim()}
          onClick={handleAdd}
        >
          Add
        </Button>
      </Group>
    </Stack>
  );
}
