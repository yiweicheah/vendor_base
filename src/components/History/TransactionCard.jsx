import { useState } from 'react';
import {
  Paper, Group, Stack, Text, Badge, ActionIcon,
  Divider, Box, Image, Collapse, Textarea, Button,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import {
  IconChevronDown, IconChevronUp,
  IconTrash, IconPencil, IconCheck, IconX,
} from '@tabler/icons-react';
import { deleteTransaction, updateTransactionNotes } from '../../lib/db';
import useAuthStore from '../../store/authStore';
import useOrgStore from '../../store/orgStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts) {
  const d = new Date(ts);
  return (
    d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: false })
  );
}

function classifyTransaction(lines) {
  const inLines  = lines.filter((l) => l.side === 'in');
  const outLines = lines.filter((l) => l.side === 'out');
  const cardsIn  = inLines.some((l)  => l.type === 'card');
  const cashIn   = inLines.some((l)  => l.type === 'cash');
  const cardsOut = outLines.some((l) => l.type === 'card');
  const cashOut  = outLines.some((l) => l.type === 'cash');
  if (cardsIn && cashOut && !cashIn && !cardsOut) return 'BUY';
  if (cashIn  && cardsOut && !cardsIn && !cashOut) return 'SELL';
  return 'TRADE';
}

const TYPE_COLOR = { BUY: 'blue', SELL: 'green', TRADE: 'violet' };

function lineTotal(lines) {
  return lines.reduce((s, l) => s + (l.unitPriceMyr || 0) * l.qty, 0);
}

// ─── Line row ─────────────────────────────────────────────────────────────────

function LineRow({ line }) {
  const isCard   = line.type === 'card';
  const isSealed = line.type === 'sealed';
  const label    = isCard ? line.cardName : isSealed ? line.sealedName : 'Cash';
  const sub      = isCard
    ? [line.cardSetName, line.cardNumber, line.cardLang].filter(Boolean).join(' · ')
    : null;
  const total = (line.unitPriceMyr || 0) * line.qty;

  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
        {isCard && (
          line.cardImageUrl
            ? <Image src={line.cardImageUrl} w={28} h={39} radius={2} fit="contain" style={{ flexShrink: 0 }} />
            : <Box w={28} h={39} bg="dark.6" style={{ borderRadius: 2, flexShrink: 0 }} />
        )}
        <Stack gap={1} style={{ minWidth: 0 }}>
          <Text size="sm" fw={500} truncate>{label ?? '—'}</Text>
          {sub && <Text size="xs" c="dimmed" truncate>{sub}</Text>}
        </Stack>
      </Group>
      <Stack gap={1} align="flex-end" style={{ flexShrink: 0 }}>
        <Text size="sm" fw={500}>RM {total.toFixed(2)}</Text>
        <Text size="xs" c="dimmed">×{line.qty}</Text>
      </Stack>
    </Group>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TransactionCard({ tx }) {
  const user   = useAuthStore((s) => s.user);
  const role   = useOrgStore((s) => s.role);
  const { removeTransaction, updateTransactionNotes: patchNotes } = useOrgStore();

  const [expanded,  setExpanded]  = useState(false);
  const [editing,   setEditing]   = useState(false);
  const [notes,     setNotes]     = useState(tx.notes ?? '');
  const [savingN,   setSavingN]   = useState(false);
  const [deletingD, setDeletingD] = useState(false);

  const canEdit = role === 'owner' || role === 'admin';

  const lines     = tx.transactionLines ?? [];
  const inLines   = lines.filter((l) => l.side === 'in');
  const outLines  = lines.filter((l) => l.side === 'out');
  const type      = classifyTransaction(lines);
  const inTotal   = lineTotal(inLines);
  const outTotal  = lineTotal(outLines);

  const cardCountIn  = inLines.filter((l)  => l.type === 'card').reduce((s, l) => s + l.qty, 0);
  const cardCountOut = outLines.filter((l) => l.type === 'card').reduce((s, l) => s + l.qty, 0);

  const summaryParts = [];
  if (cardCountIn  > 0) summaryParts.push(`${cardCountIn} card${cardCountIn !== 1 ? 's' : ''} in`);
  if (cardCountOut > 0) summaryParts.push(`${cardCountOut} card${cardCountOut !== 1 ? 's' : ''} out`);
  if (inLines.some((l)  => l.type === 'cash')) summaryParts.push('cash in');
  if (outLines.some((l) => l.type === 'cash')) summaryParts.push('cash out');

  const displayTotal = inTotal > 0 ? inTotal : outTotal;
  const creator      = tx.createdBy?.displayName;

  // ─── Delete ────────────────────────────────────────────────────────────────

  function handleDelete() {
    modals.openConfirmModal({
      title:       'Delete transaction',
      children:    <Text size="sm">This transaction will be removed from history. This cannot be undone.</Text>,
      labels:      { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm:   async () => {
        if (!user?.dbId) return;
        setDeletingD(true);
        try {
          await deleteTransaction({ txId: tx.id, deletedById: user.dbId });
          removeTransaction(tx.id);
          notifications.show({ message: 'Transaction deleted.', color: 'red', autoClose: 2000 });
        } catch (err) {
          notifications.show({ title: 'Delete failed', message: err.message, color: 'red' });
        } finally {
          setDeletingD(false);
        }
      },
    });
  }

  // ─── Save notes ────────────────────────────────────────────────────────────

  async function handleSaveNotes() {
    setSavingN(true);
    try {
      await updateTransactionNotes({ txId: tx.id, notes: notes || null });
      patchNotes(tx.id, notes || null);
      setEditing(false);
      notifications.show({ message: 'Notes updated.', color: 'green', autoClose: 2000 });
    } catch (err) {
      notifications.show({ title: 'Save failed', message: err.message, color: 'red' });
    } finally {
      setSavingN(false);
    }
  }

  function handleCancelEdit() {
    setNotes(tx.notes ?? '');
    setEditing(false);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Paper withBorder radius="md" p="md">
      {/* Header */}
      <Group justify="space-between" align="flex-start" wrap="nowrap">

        {/* Left — clickable summary */}
        <Stack
          gap={4}
          style={{ minWidth: 0, flex: 1, cursor: 'pointer' }}
          onClick={() => setExpanded((v) => !v)}
        >
          <Group gap="xs" wrap="nowrap">
            <Badge color={TYPE_COLOR[type]} variant="light" size="sm" style={{ flexShrink: 0 }}>
              {type}
            </Badge>
            <Text size="sm" fw={600} truncate>RM {displayTotal.toFixed(2)}</Text>
          </Group>
          <Text size="xs" c="dimmed" truncate>
            {summaryParts.join(' · ')}{creator ? ` · ${creator}` : ''}
          </Text>
          <Text size="xs" c="dimmed">{formatDate(tx.createdAt)}</Text>
        </Stack>

        {/* Right — action icons */}
        <Group gap={4} style={{ flexShrink: 0, marginTop: 2 }}>
          {canEdit && (
            <>
              <ActionIcon
                variant="subtle" color="gray" size="sm"
                onClick={() => { setEditing((v) => !v); setExpanded(true); }}
              >
                <IconPencil size={13} />
              </ActionIcon>
              <ActionIcon
                variant="subtle" color="red" size="sm"
                loading={deletingD}
                onClick={handleDelete}
              >
                <IconTrash size={13} />
              </ActionIcon>
            </>
          )}
          <ActionIcon
            variant="subtle" color="gray" size="sm"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <IconChevronUp size={15} /> : <IconChevronDown size={15} />}
          </ActionIcon>
        </Group>
      </Group>

      {/* Expanded body */}
      <Collapse expanded={expanded}>
        <Divider my="sm" />

        {inLines.length > 0 && (
          <Stack gap="xs" mb={outLines.length > 0 ? 'sm' : 0}>
            <Group gap="xs">
              <Text size="xs" fw={700} tt="uppercase" c="violet.4" style={{ letterSpacing: '0.08em' }}>In</Text>
              <Text size="xs" c="dimmed">RM {inTotal.toFixed(2)}</Text>
            </Group>
            <Stack gap="xs">{inLines.map((l) => <LineRow key={l.id} line={l} />)}</Stack>
          </Stack>
        )}

        {outLines.length > 0 && (
          <Stack gap="xs">
            <Group gap="xs">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.08em' }}>Out</Text>
              <Text size="xs" c="dimmed">RM {outTotal.toFixed(2)}</Text>
            </Group>
            <Stack gap="xs">{outLines.map((l) => <LineRow key={l.id} line={l} />)}</Stack>
          </Stack>
        )}

        {/* Notes — view or edit */}
        {!editing ? (
          (tx.notes || notes) && (
            <>
              <Divider my="sm" variant="dashed" />
              <Text size="xs" c="dimmed" fs="italic">{notes || tx.notes}</Text>
            </>
          )
        ) : (
          <>
            <Divider my="sm" variant="dashed" />
            <Stack gap="xs">
              <Textarea
                placeholder="Add a note…"
                value={notes}
                onChange={(e) => setNotes(e.currentTarget.value)}
                size="xs"
                autosize
                minRows={2}
                autoFocus
              />
              <Group gap="xs">
                <Button size="xs" loading={savingN} leftSection={<IconCheck size={12} />} onClick={handleSaveNotes}>
                  Save
                </Button>
                <Button size="xs" variant="subtle" color="gray" leftSection={<IconX size={12} />} onClick={handleCancelEdit}>
                  Cancel
                </Button>
              </Group>
            </Stack>
          </>
        )}
      </Collapse>
    </Paper>
  );
}
