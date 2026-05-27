import { useState, useMemo } from 'react';
import {
  Modal, Stack, Group, TextInput, ActionIcon, Divider, Paper, Text,
} from '@mantine/core';
import { IconPlus, IconPencil, IconTrash, IconCheck, IconX } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import CurrencyInput from './CurrencyInput';
import useOrgStore from '../../store/orgStore';
import {
  createEventMiscCost, updateEventMiscCost, deleteEventMiscCost,
} from '../../lib/db';
import { rm } from '../../lib/format';

export default function EventMiscCostsModal({ event, opened, onClose, org, user }) {
  const miscCosts          = useOrgStore((s) => s.miscCosts);
  const addMiscCost        = useOrgStore((s) => s.addMiscCost);
  const updateMiscCostInStore = useOrgStore((s) => s.updateMiscCost);
  const removeMiscCost     = useOrgStore((s) => s.removeMiscCost);
  const refreshAggregates  = useOrgStore((s) => s.refreshAggregates);

  const items = useMemo(
    () => miscCosts.filter((c) => c.eventId === event?.id),
    [miscCosts, event?.id],
  );
  const total = items.reduce((s, c) => s + (c.amountMyr ?? 0), 0);

  const [newLabel,  setNewLabel]  = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [adding,    setAdding]    = useState(false);

  const [editingId,  setEditingId]  = useState(null);
  const [editLabel,  setEditLabel]  = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [saving,     setSaving]     = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  function resetNew() { setNewLabel(''); setNewAmount(''); }

  async function handleAdd() {
    const amt = typeof newAmount === 'number' ? newAmount : parseFloat(newAmount);
    if (!newLabel.trim() || !amt || amt <= 0 || !org?.id || !event?.id) return;
    setAdding(true);
    try {
      const row = await createEventMiscCost({
        orgId:       org.id,
        eventId:     event.id,
        label:       newLabel.trim(),
        amountMyr:   amt,
        createdById: user?.dbId ?? null,
      });
      addMiscCost(row);
      resetNew();
      refreshAggregates(org.id);
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' });
    } finally {
      setAdding(false);
    }
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditLabel(item.label);
    setEditAmount(item.amountMyr);
  }

  async function handleSave(id) {
    const amt = typeof editAmount === 'number' ? editAmount : parseFloat(editAmount);
    if (!editLabel.trim() || !amt || amt <= 0) return;
    setSaving(true);
    try {
      await updateEventMiscCost({ id, label: editLabel.trim(), amountMyr: amt });
      updateMiscCostInStore(id, { label: editLabel.trim(), amountMyr: amt });
      setEditingId(null);
      refreshAggregates(org.id);
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    setDeletingId(id);
    try {
      await deleteEventMiscCost(id);
      removeMiscCost(id);
      refreshAggregates(org.id);
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' });
    } finally {
      setDeletingId(null);
    }
  }

  function handleClose() {
    resetNew();
    setEditingId(null);
    onClose();
  }

  return (
    <Modal opened={opened} onClose={handleClose} title={`Misc costs — ${event?.name ?? ''}`} size="sm">
      <Stack gap="sm">
        <Group gap="xs" align="flex-end">
          <TextInput
            label="Label"
            placeholder="Booth rental"
            value={newLabel}
            onChange={(e) => setNewLabel(e.currentTarget.value)}
            style={{ flex: 1 }}
            size="xs"
          />
          <CurrencyInput
            label="Amount"
            placeholder="0.00"
            leftSection={<Text size="xs" c="dimmed">RM</Text>}
            value={newAmount}
            onChange={setNewAmount}
            size="xs"
            style={{ width: 110 }}
          />
          <ActionIcon
            color="violet"
            size="sm"
            loading={adding}
            disabled={!newLabel.trim() || !(parseFloat(newAmount) > 0)}
            onClick={handleAdd}
            mb={1}
          >
            <IconPlus size={14} />
          </ActionIcon>
        </Group>

        {items.length > 0 && <Divider />}

        {items.map((item) => (
          <Paper key={item.id} withBorder p="xs" radius="md">
            {editingId === item.id ? (
              <Group gap="xs" align="flex-end">
                <TextInput
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.currentTarget.value)}
                  size="xs"
                  style={{ flex: 1 }}
                  autoFocus
                />
                <CurrencyInput
                  value={editAmount}
                  onChange={setEditAmount}
                  size="xs"
                  style={{ width: 100 }}
                  leftSection={<Text size="xs" c="dimmed">RM</Text>}
                />
                <ActionIcon size="sm" color="green" loading={saving} onClick={() => handleSave(item.id)}>
                  <IconCheck size={13} />
                </ActionIcon>
                <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => setEditingId(null)} disabled={saving}>
                  <IconX size={13} />
                </ActionIcon>
              </Group>
            ) : (
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" truncate style={{ flex: 1 }}>{item.label}</Text>
                <Group gap={4} wrap="nowrap">
                  <Text size="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>{rm(item.amountMyr ?? 0)}</Text>
                  <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => startEdit(item)}>
                    <IconPencil size={11} />
                  </ActionIcon>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color="red"
                    loading={deletingId === item.id}
                    onClick={() => handleDelete(item.id)}
                  >
                    <IconTrash size={11} />
                  </ActionIcon>
                </Group>
              </Group>
            )}
          </Paper>
        ))}

        {items.length > 0 && (
          <>
            <Divider />
            <Group justify="space-between">
              <Text size="sm" fw={600}>Total</Text>
              <Text size="sm" fw={700}>{rm(total)}</Text>
            </Group>
          </>
        )}

        {items.length === 0 && (
          <Text size="xs" c="dimmed" ta="center" py="xs">No misc costs yet. Add one above.</Text>
        )}
      </Stack>
    </Modal>
  );
}
