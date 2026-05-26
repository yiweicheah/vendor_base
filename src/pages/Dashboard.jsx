import { useEffect, useMemo, useState, useRef } from 'react';
import {
  Box, ScrollArea, Stack, Paper, Group, Text, Divider, Loader,
  ThemeIcon, Center, Button, Modal, TextInput, ActionIcon,
  Select, Pagination, Table, ScrollArea as SA,
} from '@mantine/core';
import CurrencyInput from '../components/shared/CurrencyInput';
import {
  IconChartBar, IconTrendingUp, IconTrendingDown, IconMinus, IconPlus, IconPencil,
  IconChevronDown, IconChevronUp, IconChevronLeft, IconChevronRight,
  IconSearch, IconArrowUp, IconArrowDown, IconHistory,
  IconCheck, IconX, IconReceipt, IconDownload, IconTrash,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import useOrgStore from '../store/orgStore';
import useAuthStore from '../store/authStore';
// Dashboard reads pre-aggregated metrics/monthlyPL/eventBreakdown from the
// store (populated via Supabase RPCs in App.jsx). The compute* helpers stay
// in src/lib/analytics.js as truth-table refs for the parity test only.
const DEFAULT_METRICS = {
  txCount: 0, cashIn: 0, cashOut: 0, totalIn: 0, totalOut: 0, netCashFlow: 0,
  cardBuyQty: 0, cardSellQty: 0, cardSoldTotal: 0, profitComplete: true,
  cogs: 0, stockQty: 0, stockCost: 0, stockMarket: 0, unrealizedGain: 0,
  grossProfit: 0, totalMiscCosts: 0, totalFixedCosts: 0, netPL: 0,
};
const DEFAULT_MPL = {
  txCount: 0, cardBuyQty: 0, cardSellQty: 0,
  revenue: 0, purchases: 0, openingStock: 0, closingStock: 0,
  grossProfit: 0, miscCosts: 0, fixedCosts: 0, netPL: 0,
};
import {
  createFundEntry, updateFundEntry,
  createEventMiscCost, updateEventMiscCost, deleteEventMiscCost,
  createFixedCost, updateFixedCost, deleteFixedCost,
  loadTransactionsForMonth,
} from '../lib/db';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rm(n) {
  return `RM ${Math.abs(n).toFixed(2)}`;
}

function sign(n) {
  if (n > 0.005) return '+';
  if (n < -0.005) return '−';
  return '';
}

function netColor(n) {
  if (n > 0.005) return 'green.4';
  if (n < -0.005) return 'red.4';
  return 'dimmed';
}

function TrendIcon({ value, size = 14 }) {
  if (value > 0.005)  return <IconTrendingUp  size={size} />;
  if (value < -0.005) return <IconTrendingDown size={size} />;
  return <IconMinus size={size} />;
}

function MetaRow({ label, value, valueColor = undefined, bold = false }) {
  return (
    <Group justify="space-between">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="xs" fw={bold ? 600 : 400} c={valueColor}>{value}</Text>
    </Group>
  );
}

function SectionLabel({ children }) {
  return (
    <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.08em' }}>
      {children}
    </Text>
  );
}

// ─── Fund History modal ───────────────────────────────────────────────────────

function FundHistoryModal({ opened, onClose, funds }) {
  const role = useOrgStore((s) => s.role);
  const updateFundEntryInStore = useOrgStore((s) => s.updateFundEntry);
  const canEdit = role === 'owner' || role === 'admin';

  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editNote,  setEditNote]  = useState('');
  const [saving, setSaving] = useState(false);

  const total = funds.reduce((sum, f) => sum + (f.amountMyr ?? 0), 0);

  function startEdit(f) {
    setEditingId(f.id);
    setEditValue(f.amountMyr ?? 0);
    setEditNote(f.note ?? '');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue('');
    setEditNote('');
  }

  async function handleSave(id) {
    const amt = typeof editValue === 'number' ? editValue : parseFloat(editValue);
    if (!amt || amt <= 0) return;
    setSaving(true);
    const note = editNote.trim() || null;
    try {
      await updateFundEntry({ id, amountMyr: amt, note });
      updateFundEntryInStore(id, { amountMyr: amt, note });
      setEditingId(null);
      notifications.show({ message: `Deposit updated.`, color: 'green', autoClose: 2000 });
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Fund deposit history" size="md">
      <Stack gap="sm">
        {funds.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="md">No deposits yet.</Text>
        ) : (
          <>
            {funds.map((f) => (
              <Paper key={f.id} withBorder p="sm" radius="md">
                <Stack gap={6}>
                  <Text size="xs" c="dimmed">
                    {new Date(f.createdAt).toLocaleString(undefined, {
                      dateStyle: 'medium', timeStyle: 'short',
                    })}
                    {f.createdBy?.displayName ? ` · ${f.createdBy.displayName}` : ''}
                  </Text>
                  {editingId === f.id ? (
                    <>
                      <Group gap={4} wrap="nowrap">
                        <CurrencyInput
                          value={editValue}
                          onChange={setEditValue}
                          size="xs"
                          style={{ flex: 1 }}
                          leftSection={<Text size="xs" c="dimmed">RM</Text>}
                          autoFocus
                        />
                        <ActionIcon size="sm" color="green" loading={saving} onClick={() => handleSave(f.id)}>
                          <IconCheck size={14} />
                        </ActionIcon>
                        <ActionIcon size="sm" variant="subtle" color="gray" onClick={cancelEdit} disabled={saving}>
                          <IconX size={14} />
                        </ActionIcon>
                      </Group>
                      <TextInput
                        placeholder="Note (optional)"
                        value={editNote}
                        onChange={(e) => setEditNote(e.currentTarget.value)}
                        size="xs"
                      />
                    </>
                  ) : (
                    <Group justify="space-between" wrap="nowrap">
                      {f.note
                        ? <Text size="sm" c="dimmed" truncate style={{ flex: 1, minWidth: 0 }}>{f.note}</Text>
                        : <span />
                      }
                      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                        <Text size="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
                          +RM {(f.amountMyr ?? 0).toFixed(2)}
                        </Text>
                        {canEdit && (
                          <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => startEdit(f)}>
                            <IconPencil size={12} />
                          </ActionIcon>
                        )}
                      </Group>
                    </Group>
                  )}
                </Stack>
              </Paper>
            ))}
            <Divider />
            <Group justify="space-between">
              <Text size="sm" fw={600}>Total deposited</Text>
              <Text size="sm" fw={700}>RM {total.toFixed(2)}</Text>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}

// ─── Add Funds modal ──────────────────────────────────────────────────────────

function AddFundsModal({ opened, onClose, org, user, onAdded }) {
  const [amount,    setAmount]    = useState('');
  const [note,      setNote]      = useState('');
  const [loading,   setLoading]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const amt = typeof amount === 'number' ? amount : parseFloat(amount);
    if (!amt || amt <= 0 || !org?.id || !user?.dbId) return;

    setLoading(true);
    try {
      const entry = await createFundEntry({
        orgId:       org.id,
        amountMyr:   amt,
        note:        note.trim() || null,
        createdById: user.dbId,
      });
      onAdded({ ...entry, amountMyr: amt });
      setAmount('');
      setNote('');
      onClose();
      notifications.show({ message: `RM ${amt.toFixed(2)} added to funds.`, color: 'green', autoClose: 2000 });
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setAmount('');
    setNote('');
    onClose();
  }

  return (
    <Modal opened={opened} onClose={handleClose} title="Add funds" size="sm">
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <CurrencyInput
            label="Amount (MYR)"
            placeholder="0.00"
            leftSection={<Text size="xs" c="dimmed">RM</Text>}
            value={amount}
            onChange={setAmount}
            required
            autoFocus
          />
          <TextInput
            label="Note"
            placeholder="e.g. Cash injection for Nationals"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
          <Button
            type="submit"
            loading={loading}
            disabled={!amount || (typeof amount === 'number' ? amount : parseFloat(amount)) <= 0}
            mt="xs"
          >
            Add funds
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

// ─── Event Misc Costs modal ───────────────────────────────────────────────────

function EventMiscCostsModal({ event, opened, onClose, org, user }) {
  const miscCosts     = useOrgStore((s) => s.miscCosts);
  const addMiscCost   = useOrgStore((s) => s.addMiscCost);
  const updateMiscCostInStore = useOrgStore((s) => s.updateMiscCost);
  const removeMiscCost = useOrgStore((s) => s.removeMiscCost);
  const refreshAggregates = useOrgStore((s) => s.refreshAggregates);

  const items = useMemo(
    () => miscCosts.filter((c) => c.eventId === event?.id),
    [miscCosts, event?.id]
  );
  const total = items.reduce((s, c) => s + (c.amountMyr ?? 0), 0);

  const [newLabel,  setNewLabel]  = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [adding,    setAdding]    = useState(false);

  const [editingId,    setEditingId]    = useState(null);
  const [editLabel,    setEditLabel]    = useState('');
  const [editAmount,   setEditAmount]   = useState('');
  const [saving,       setSaving]       = useState(false);
  const [deletingId,   setDeletingId]   = useState(null);

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
        {/* Add new item */}
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

        {/* Existing items */}
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
                  <Text size="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
                    RM {(item.amountMyr ?? 0).toFixed(2)}
                  </Text>
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
              <Text size="sm" fw={700}>RM {total.toFixed(2)}</Text>
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

// ─── Fixed Costs modal ────────────────────────────────────────────────────────

function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function toFirstOfMonth(ym) {
  return `${ym}-01`;
}

function FixedCostsModal({ opened, onClose, org, user }) {
  const fixedCosts    = useOrgStore((s) => s.fixedCosts);
  const addFixedCost  = useOrgStore((s) => s.addFixedCost);
  const updateFixedCostInStore = useOrgStore((s) => s.updateFixedCost);
  const removeFixedCost = useOrgStore((s) => s.removeFixedCost);
  const refreshAggregates = useOrgStore((s) => s.refreshAggregates);

  // derive available months + current month as default
  const nowYM = new Date().toISOString().slice(0, 7);
  const existingMonths = useMemo(() => {
    const s = new Set(fixedCosts.map((c) => c.month?.slice(0, 7)));
    s.add(nowYM);
    return [...s].sort().reverse();
  }, [fixedCosts, nowYM]);

  const [selectedMonth, setSelectedMonth] = useState(nowYM);

  const [newLabel,  setNewLabel]  = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [adding,    setAdding]    = useState(false);

  const [editingId,  setEditingId]  = useState(null);
  const [editLabel,  setEditLabel]  = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [saving,     setSaving]     = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const itemsForMonth = useMemo(
    () => fixedCosts.filter((c) => c.month?.slice(0, 7) === selectedMonth),
    [fixedCosts, selectedMonth]
  );
  const total = itemsForMonth.reduce((s, c) => s + (c.amountMyr ?? 0), 0);

  const monthOptions = useMemo(() => existingMonths.map((ym) => ({
    value: ym,
    label: monthLabel(ym),
  })), [existingMonths]);

  function resetNew() { setNewLabel(''); setNewAmount(''); }

  async function handleAdd() {
    const amt = typeof newAmount === 'number' ? newAmount : parseFloat(newAmount);
    if (!newLabel.trim() || !amt || amt <= 0 || !org?.id) return;
    setAdding(true);
    try {
      const row = await createFixedCost({
        orgId:       org.id,
        label:       newLabel.trim(),
        amountMyr:   amt,
        month:       toFirstOfMonth(selectedMonth),
        createdById: user?.dbId ?? null,
      });
      addFixedCost(row);
      resetNew();
      // ensure the new month appears in list
      if (!existingMonths.includes(selectedMonth)) {
        setSelectedMonth(selectedMonth);
      }
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
      await updateFixedCost({ id, label: editLabel.trim(), amountMyr: amt });
      updateFixedCostInStore(id, { label: editLabel.trim(), amountMyr: amt });
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
      await deleteFixedCost(id);
      removeFixedCost(id);
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
    <Modal opened={opened} onClose={handleClose} title="Monthly fixed costs" size="sm">
      <Stack gap="sm">
        <Select
          label="Month"
          data={monthOptions}
          value={selectedMonth}
          onChange={(v) => { setSelectedMonth(v); setEditingId(null); }}
          allowDeselect={false}
          size="xs"
          searchable
        />

        {/* Add new item */}
        <Group gap="xs" align="flex-end">
          <TextInput
            label="Label"
            placeholder="Salary, hosting…"
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

        {itemsForMonth.length > 0 && <Divider />}

        {itemsForMonth.map((item) => (
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
                  <Text size="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
                    RM {(item.amountMyr ?? 0).toFixed(2)}
                  </Text>
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

        {itemsForMonth.length === 0 && (
          <Text size="xs" c="dimmed" ta="center" py="xs">No fixed costs for this month yet.</Text>
        )}

        {itemsForMonth.length > 0 && (
          <>
            <Divider />
            <Group justify="space-between">
              <Text size="sm" fw={600}>Total</Text>
              <Text size="sm" fw={700}>RM {total.toFixed(2)}</Text>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}

// ─── Export P&L modal ─────────────────────────────────────────────────────────

function ExportPLModal({ opened, onClose, miscCosts, fixedCosts, events, monthlyPL }) {
  const org = useOrgStore((s) => s.org);
  const toYM   = (iso) => (iso ?? '').slice(0, 7);
  const toDate = (iso) => (iso ?? '').slice(0, 10);

  // Month list comes from monthlyPL — get_org_monthly_pl already unions tx, misc, and fixed
  // cost months server-side, so this is the authoritative set.
  const allMonths = useMemo(
    () => [...new Set(monthlyPL.map((r) => r.month))].filter(Boolean).sort().reverse(),
    [monthlyPL],
  );
  const monthOptions = allMonths.map((ym) => ({ value: ym, label: monthLabel(ym) }));
  const [selectedMonth, setSelectedMonth] = useState(() => allMonths[0] ?? '');

  // Lazy-fetch transactions for the selected month — only the chosen month is loaded,
  // not the global transactions blob. Re-runs when the user picks a different month.
  const [filteredTxs, setFilteredTxs] = useState([]);
  const [txLoading, setTxLoading] = useState(false);
  useEffect(() => {
    if (!opened || !selectedMonth || !org?.id) return;
    let cancelled = false;
    setTxLoading(true);
    loadTransactionsForMonth(org.id, selectedMonth)
      .then((rows) => { if (!cancelled) setFilteredTxs(rows); })
      .catch((err) => {
        if (cancelled) return;
        console.error('loadTransactionsForMonth error:', err);
        notifications.show({ title: 'Failed to load month', message: err.message, color: 'red' });
        setFilteredTxs([]);
      })
      .finally(() => { if (!cancelled) setTxLoading(false); });
    return () => { cancelled = true; };
  }, [opened, selectedMonth, org?.id]);

  // event id → startsAt month / date
  const eventMonth = useMemo(() => {
    const m = new Map();
    for (const e of events) if (e.startsAt) m.set(e.id, toYM(e.startsAt));
    return m;
  }, [events]);

  const eventDate = useMemo(() => {
    const m = new Map();
    for (const e of events) if (e.startsAt) m.set(e.id, toDate(e.startsAt));
    return m;
  }, [events]);

  // ── filtered slices ──────────────────────────────────────────────────────

  const filteredMiscCosts = useMemo(() => {
    if (!selectedMonth) return [];
    return miscCosts.filter((c) => (eventMonth.get(c.eventId) ?? toYM(c.createdAt)) === selectedMonth);
  }, [miscCosts, selectedMonth, eventMonth]);

  const filteredFixedCosts = useMemo(() => {
    if (!selectedMonth) return [];
    return fixedCosts.filter((c) => toYM(c.month) === selectedMonth);
  }, [fixedCosts, selectedMonth]);

  // ── P&L figures ──────────────────────────────────────────────────────────

  const pnl = useMemo(
    () => monthlyPL.find((r) => r.month === selectedMonth) ?? DEFAULT_MPL,
    [monthlyPL, selectedMonth],
  );

  const hasData = filteredTxs.length > 0 || filteredMiscCosts.length > 0 || filteredFixedCosts.length > 0;

  // ── CSV export ───────────────────────────────────────────────────────────

  function esc(v) {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function row(...fields) { return fields.map(esc).join(','); }

  function handleExport() {
    const lines = [];
    const period = selectedMonth ? monthLabel(selectedMonth) : '';

    // Block 1: P&L summary
    lines.push(row('Company',  org?.name ?? ''));
    lines.push(row('Report',   'P&L Statement'));
    lines.push(row('Period',   period));
    lines.push(row('Currency', 'MYR'));
    lines.push('');
    lines.push(row('Section', 'Item', 'Amount'));
    lines.push(row('Revenue',            'Sales Revenue',            pnl.revenue.toFixed(2)));
    lines.push(row('Opening Stock',      'Opening stock (at cost)',  (-pnl.openingStock).toFixed(2)));
    lines.push(row('Purchases',          'Purchases',                (-pnl.purchases).toFixed(2)));
    lines.push(row('Closing Stock',      'Closing stock (at cost)',  pnl.closingStock.toFixed(2)));
    lines.push(row('Gross Profit',       '',                         pnl.grossProfit.toFixed(2)));
    lines.push(row('Operating Expenses', 'Event Costs',              (-pnl.miscCosts).toFixed(2)));
    lines.push(row('Operating Expenses', 'Fixed Costs',              (-pnl.fixedCosts).toFixed(2)));
    lines.push(row('Net Profit',         '',                         pnl.netPL.toFixed(2)));
    lines.push('');

    // Block 2: transaction detail
    lines.push(row('Date', 'Type', 'Category', 'Description', 'Amount'));

    for (const tx of filteredTxs) {
      const date = toDate(tx.createdAt);
      let cardRev = 0, sealedRev = 0;
      for (const line of tx.transactionLines ?? []) {
        if (line.side !== 'out') continue;
        const value = (line.unitPriceMyr || 0) * line.qty;
        if (line.type === 'card')   cardRev   += value;
        else if (line.type === 'sealed') sealedRev += value;
      }
      if (cardRev   > 0) lines.push(row(date, 'Revenue', 'Card Sales',      'Card Singles Sales',    cardRev.toFixed(2)));
      if (sealedRev > 0) lines.push(row(date, 'Revenue', 'Sealed Products', 'Sealed Products Sales', sealedRev.toFixed(2)));
    }

    for (const c of filteredMiscCosts) {
      const date      = eventDate.get(c.eventId) ?? toDate(c.createdAt);
      const eventName = events.find((e) => e.id === c.eventId)?.name ?? '—';
      lines.push(row(date, 'Expense', c.label, eventName, (-(c.amountMyr || 0)).toFixed(2)));
    }

    for (const c of filteredFixedCosts) {
      const date = (c.month ?? '').slice(0, 10);
      lines.push(row(date, 'Expense', c.label, 'Fixed Cost', (-(c.amountMyr || 0)).toFixed(2)));
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `pl_${selectedMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <Modal opened={opened} onClose={onClose} title="Export P&L" size="md">
      <Stack gap="md">
        <Select
          label="Month"
          data={monthOptions}
          value={selectedMonth}
          onChange={setSelectedMonth}
          allowDeselect={false}
          size="xs"
        />

        {txLoading ? (
          <Center py="sm"><Loader color="violet" size="sm" /></Center>
        ) : !hasData ? (
          <Text size="xs" c="dimmed" ta="center" py="sm">No data for selected month.</Text>
        ) : (
          <Table withTableBorder withColumnBorders fz="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Section</Table.Th>
                <Table.Th>Item</Table.Th>
                <Table.Th ta="right">Amount (MYR)</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td>Revenue</Table.Td>
                <Table.Td>Sales Revenue</Table.Td>
                <Table.Td ta="right">{pnl.revenue.toFixed(2)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Opening Stock</Table.Td>
                <Table.Td>Opening stock (at cost)</Table.Td>
                <Table.Td ta="right">−{pnl.openingStock.toFixed(2)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Purchases</Table.Td>
                <Table.Td>Purchases</Table.Td>
                <Table.Td ta="right">−{pnl.purchases.toFixed(2)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Closing Stock</Table.Td>
                <Table.Td>Closing stock (at cost)</Table.Td>
                <Table.Td ta="right">+{pnl.closingStock.toFixed(2)}</Table.Td>
              </Table.Tr>
              <Table.Tr style={{ fontWeight: 600 }}>
                <Table.Td>Gross Profit</Table.Td>
                <Table.Td></Table.Td>
                <Table.Td ta="right" c={netColor(pnl.grossProfit)}>{pnl.grossProfit.toFixed(2)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Operating Expenses</Table.Td>
                <Table.Td>Event Costs</Table.Td>
                <Table.Td ta="right">−{pnl.miscCosts.toFixed(2)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Operating Expenses</Table.Td>
                <Table.Td>Fixed Costs</Table.Td>
                <Table.Td ta="right">−{pnl.fixedCosts.toFixed(2)}</Table.Td>
              </Table.Tr>
              <Table.Tr style={{ fontWeight: 700 }}>
                <Table.Td>Net Profit</Table.Td>
                <Table.Td></Table.Td>
                <Table.Td ta="right" c={netColor(pnl.netPL)}>{pnl.netPL.toFixed(2)}</Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        )}

        <Button
          leftSection={<IconDownload size={14} />}
          disabled={!hasData || txLoading}
          onClick={handleExport}
        >
          Download CSV
        </Button>
      </Stack>
    </Modal>
  );
}

// ─── By Event section ────────────────────────────────────────────────────────

const EVENT_SORT_OPTIONS = [
  { value: 'txCount',     label: 'Most transactions' },
  { value: 'grossProfit', label: 'Profit' },
  { value: 'netCashFlow', label: 'Net cash flow' },
  { value: 'totalOut',    label: 'Sales' },
  { value: 'date',        label: 'Date' },
  { value: 'name',        label: 'Name' },
];
const PAGE_SIZE = 5;

function ByEventSection({ breakdown, events, canEdit, onManageCosts, org, user }) {
  const [collapsed, setCollapsedRaw] = useState(
    () => localStorage.getItem('dashboard_events_collapsed') === 'true'
  );
  const [sort, setSortRaw] = useState(
    () => localStorage.getItem('dashboard_events_sort') ?? 'txCount'
  );
  const [sortDir, setSortDirRaw] = useState(
    () => localStorage.getItem('dashboard_events_sort_dir') ?? 'desc'
  );
  const [search, setSearch] = useState('');
  const [page,   setPage]   = useState(1);
  const topRef = useRef(null);

  const [miscCostsEvent, setMiscCostsEvent] = useState(null);

  function setCollapsed(v) { setCollapsedRaw(v); localStorage.setItem('dashboard_events_collapsed', String(v)); }
  function setSort(v)      { setSortRaw(v);      localStorage.setItem('dashboard_events_sort', v);     setPage(1); }
  function setSortDir(v)   { setSortDirRaw(v);   localStorage.setItem('dashboard_events_sort_dir', v); setPage(1); }
  function handleSearch(v) { setSearch(v); setPage(1); }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return breakdown;
    return breakdown.filter((ev) => (ev.name ?? '').toLowerCase().includes(q));
  }, [breakdown, search]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    const dir  = sortDir === 'asc' ? 1 : -1;

    if (sort === 'name') {
      copy.sort((a, b) => dir * (a.name ?? '').localeCompare(b.name ?? ''));
    } else if (sort === 'date') {
      copy.sort((a, b) => {
        if (a.id === '__none__') return 1;
        if (b.id === '__none__') return -1;
        const aTs = events.find((e) => e.id === a.id)?.startsAt ?? '';
        const bTs = events.find((e) => e.id === b.id)?.startsAt ?? '';
        return dir * (aTs < bTs ? -1 : aTs > bTs ? 1 : 0);
      });
    } else {
      copy.sort((a, b) => dir * (a[sort] - b[sort]));
    }
    return copy;
  }, [filtered, sort, sortDir, events]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paginated  = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <Stack gap="sm" ref={topRef}>
      <Group justify="space-between" align="center">
        <Group
          gap={4}
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setCollapsed(!collapsed)}
        >
          <SectionLabel>By Event</SectionLabel>
          <ActionIcon variant="transparent" color="gray" size="xs" tabIndex={-1}>
            {collapsed ? <IconChevronDown size={12} /> : <IconChevronUp size={12} />}
          </ActionIcon>
        </Group>
        {!collapsed && (
          <Group gap={4}>
            <Select
              data={EVENT_SORT_OPTIONS}
              value={sort}
              onChange={setSort}
              size="xs"
              w={140}
              allowDeselect={false}
            />
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={() => setSortDir(sortDir === 'desc' ? 'asc' : 'desc')}
            >
              {sortDir === 'desc' ? <IconArrowDown size={14} /> : <IconArrowUp size={14} />}
            </ActionIcon>
          </Group>
        )}
      </Group>

      {!collapsed && (
        <Stack gap="xs">
          <TextInput
            placeholder="Search events…"
            leftSection={<IconSearch size={13} />}
            value={search}
            onChange={(e) => handleSearch(e.currentTarget.value)}
            size="xs"
          />

          {paginated.length === 0 ? (
            <Text size="xs" c="dimmed" ta="center" py="sm">No events match.</Text>
          ) : (
            paginated.map((ev) => (
              <Paper key={ev.id} withBorder p="sm" radius="md">
                <Stack gap="xs">
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm" fw={500} truncate>{ev.name}</Text>
                    <Group gap={4} style={{ flexShrink: 0 }}>
                      <Text size="xs" c="dimmed">{ev.txCount} tx</Text>
                      {canEdit && ev.id !== '__none__' && (
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="xs"
                          title="Misc costs"
                          onClick={() => setMiscCostsEvent(events.find((e) => e.id === ev.id) ?? null)}
                        >
                          <IconReceipt size={11} />
                        </ActionIcon>
                      )}
                    </Group>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Sales</Text>
                    <Text size="xs">{rm(ev.totalOut)}</Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Purchases</Text>
                    <Text size="xs" c="dimmed">−{rm(ev.totalIn)}</Text>
                  </Group>
                  {ev.cardSoldTotal > 0 && (
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">Gross profit{!ev.profitComplete ? ' ~' : ''}</Text>
                      <Text size="xs" fw={500} c={netColor(ev.grossProfit)}>
                        {sign(ev.grossProfit)}{rm(ev.grossProfit)}
                      </Text>
                    </Group>
                  )}
                  {ev.miscCostTotal > 0 && (
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">Misc costs</Text>
                      <Text size="xs" c="dimmed">−{rm(ev.miscCostTotal)}</Text>
                    </Group>
                  )}
                  <Divider variant="dashed" />
                  <Group justify="space-between">
                    <Text size="xs" fw={600}>Total Fund In/Out</Text>
                    <Text size="xs" fw={600} c={netColor(ev.miscCostTotal > 0 ? ev.netPL : ev.netCashFlow)}>
                      {sign(ev.miscCostTotal > 0 ? ev.netPL : ev.netCashFlow)}
                      {rm(ev.miscCostTotal > 0 ? ev.netPL : ev.netCashFlow)}
                    </Text>
                  </Group>
                </Stack>
              </Paper>
            ))
          )}

          {totalPages > 1 && (
            <Group justify="center" mt="xs">
              <Pagination total={totalPages} value={safePage} onChange={(p) => { setPage(p); topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} size="xs" />
            </Group>
          )}
        </Stack>
      )}

      {/* Event misc costs modal */}
      <EventMiscCostsModal
        event={miscCostsEvent}
        opened={!!miscCostsEvent}
        onClose={() => setMiscCostsEvent(null)}
        org={org}
        user={user}
      />
    </Stack>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const funds           = useOrgStore((s) => s.funds);
  const org             = useOrgStore((s) => s.org);
  const role            = useOrgStore((s) => s.role);
  const events          = useOrgStore((s) => s.events);
  const miscCosts       = useOrgStore((s) => s.miscCosts);
  const fixedCosts      = useOrgStore((s) => s.fixedCosts);
  const metrics         = useOrgStore((s) => s.metrics);
  const eventBreakdown  = useOrgStore((s) => s.eventBreakdown);
  const monthlyPL       = useOrgStore((s) => s.monthlyPL);
  const addFundEntry    = useOrgStore((s) => s.addFundEntry);
  const user            = useAuthStore((s) => s.user);

  const [modalOpen,       setModalOpen]       = useState(false);
  const [historyOpen,     setHistoryOpen]      = useState(false);
  const [fixedCostsOpen,  setFixedCostsOpen]  = useState(false);
  const [exportOpen,      setExportOpen]      = useState(false);

  const m            = metrics ?? DEFAULT_METRICS;
  const totalFunds   = useMemo(() => funds.reduce((sum, f) => sum + (f.amountMyr ?? 0), 0), [funds]);
  const fundOnHand   = totalFunds + m.netCashFlow;
  const canAddFunds  = role === 'owner' || role === 'admin';

  const nowYM = new Date().toISOString().slice(0, 7);
  const [plMonth, setPlMonth] = useState(nowYM);

  const plMonths = useMemo(() => monthlyPL.map((r) => r.month), [monthlyPL]);

  const effectivePlMonth = plMonths.includes(plMonth)
    ? plMonth
    : (plMonths[plMonths.length - 1] ?? plMonth);
  const plMonthIdx   = plMonths.indexOf(effectivePlMonth);
  const canPrevMonth = plMonthIdx > 0;
  const canNextMonth = plMonthIdx < plMonths.length - 1;

  const mpl = monthlyPL.find((r) => r.month === effectivePlMonth) ?? DEFAULT_MPL;

  const hasContent = (metrics?.txCount ?? 0) > 0 || funds.length > 0;
  if (!hasContent) {
    return (
      <>
        <Center h="100%">
          <Stack align="center" gap="md">
            <ThemeIcon size={48} variant="light" color="violet">
              <IconChartBar size={28} />
            </ThemeIcon>
            <Text c="dimmed" size="sm">No transactions yet</Text>
            {canAddFunds && (
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPlus size={13} />}
                onClick={() => setModalOpen(true)}
              >
                Add funds
              </Button>
            )}
          </Stack>
        </Center>
        <AddFundsModal
          opened={modalOpen}
          onClose={() => setModalOpen(false)}
          org={org}
          user={user}
          onAdded={addFundEntry}
        />
        <FundHistoryModal
          opened={historyOpen}
          onClose={() => setHistoryOpen(false)}
          funds={funds}
        />
      </>
    );
  }

  return (
    <>
      <Box style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <ScrollArea style={{ flex: 1 }} p="md">
          <Stack gap="md" pb="md">

            {/* ── Cash Balance ─────────────────────────────────────────────── */}
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <SectionLabel>Cash Balance</SectionLabel>
                {canAddFunds && (
                  <Button
                    size="xs"
                    variant="subtle"
                    color="violet"
                    leftSection={<IconPlus size={12} />}
                    onClick={() => setModalOpen(true)}
                    px={6}
                  >
                    Add funds
                  </Button>
                )}
              </Group>
              <Paper withBorder p="md" radius="md">
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Funds deposited</Text>
                    <Group gap={4}>
                      <Text size="xs">{rm(totalFunds)}</Text>
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        color="gray"
                        onClick={() => setHistoryOpen(true)}
                        title="View deposit history"
                      >
                        <IconHistory size={12} />
                      </ActionIcon>
                    </Group>
                  </Group>
                  <MetaRow
                    label="Net from trades"
                    value={`${sign(m.netCashFlow)}${rm(m.netCashFlow)}`}
                    valueColor={netColor(m.netCashFlow)}
                  />
                  <Divider />
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>Fund on hand</Text>
                    <Group gap={4}>
                      <ThemeIcon size="xs" variant="transparent" color={netColor(fundOnHand)}>
                        <TrendIcon value={fundOnHand} />
                      </ThemeIcon>
                      <Text size="sm" fw={700} c={netColor(fundOnHand)}>
                        {sign(fundOnHand)}{rm(fundOnHand)}
                      </Text>
                    </Group>
                  </Group>
                </Stack>
              </Paper>
            </Stack>

            {/* ── P&L Summary ──────────────────────────────────────────────── */}
            {(metrics?.txCount ?? 0) > 0 && (
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Group gap={6} align="center">
                    <SectionLabel>P&L Summary</SectionLabel>
                    <Group gap={2} align="center">
                      <ActionIcon
                        size="xs" variant="subtle" color="gray"
                        disabled={!canPrevMonth}
                        onClick={() => setPlMonth(plMonths[plMonthIdx - 1])}
                      >
                        <IconChevronLeft size={12} />
                      </ActionIcon>
                      <Text size="xs" fw={500} style={{ minWidth: 96, textAlign: 'center' }}>
                        {monthLabel(effectivePlMonth)}
                      </Text>
                      <ActionIcon
                        size="xs" variant="subtle" color="gray"
                        disabled={!canNextMonth}
                        onClick={() => setPlMonth(plMonths[plMonthIdx + 1])}
                      >
                        <IconChevronRight size={12} />
                      </ActionIcon>
                    </Group>
                  </Group>
                  <Group gap={4}>
                    {canAddFunds && (
                      <Button
                        size="xs"
                        variant="subtle"
                        color="gray"
                        px={6}
                        onClick={() => setFixedCostsOpen(true)}
                      >
                        Fixed costs
                      </Button>
                    )}
                    <Button
                      size="xs"
                      variant="subtle"
                      color="gray"
                      leftSection={<IconDownload size={12} />}
                      px={6}
                      onClick={() => setExportOpen(true)}
                    >
                      Export
                    </Button>
                  </Group>
                </Group>
                <Paper withBorder p="md" radius="md">
                  <Stack gap="xs">
                    {/* Metadata */}
                    <MetaRow label="Transactions" value={mpl.txCount} />
                    <MetaRow label="Cards bought"  value={`${mpl.cardBuyQty} pcs`} />
                    <MetaRow label="Cards sold"    value={`${mpl.cardSellQty} pcs`} />

                    <Divider variant="dashed" />

                    {/* Revenue */}
                    <Group justify="space-between">
                      <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.06em' }}>Revenue (Sales)</Text>
                      <Text size="xs" fw={600}>{rm(mpl.revenue)}</Text>
                    </Group>
                    <MetaRow label="Opening stock (at cost)" value={`−${rm(mpl.openingStock)}`} />
                    <MetaRow label="Purchases"               value={`−${rm(mpl.purchases)}`} />
                    <MetaRow label="Closing stock (at cost)" value={`+${rm(mpl.closingStock)}`} />

                    <Divider variant="dashed" />

                    {/* Gross Profit */}
                    <Group justify="space-between">
                      <Text size="sm" fw={600}>Gross Profit</Text>
                      <Text size="sm" fw={600} c={netColor(mpl.grossProfit)}>
                        {sign(mpl.grossProfit)}{rm(mpl.grossProfit)}
                      </Text>
                    </Group>

                    <Divider variant="dashed" />

                    {/* Operating Expenses */}
                    <Group justify="space-between">
                      <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.06em' }}>Operating Expenses</Text>
                      <Text size="xs" c="dimmed">−{rm(mpl.miscCosts + mpl.fixedCosts)}</Text>
                    </Group>
                    <MetaRow label="Event misc costs" value={`−${rm(mpl.miscCosts)}`} />
                    <MetaRow label="Fixed costs"      value={`−${rm(mpl.fixedCosts)}`} />

                    <Divider />

                    {/* Net Profit */}
                    <Group justify="space-between">
                      <Text size="sm" fw={600}>Net Profit</Text>
                      <Group gap={4}>
                        <ThemeIcon size="xs" variant="transparent" color={netColor(mpl.netPL)}>
                          <TrendIcon value={mpl.netPL} />
                        </ThemeIcon>
                        <Text size="sm" fw={700} c={netColor(mpl.netPL)}>
                          {sign(mpl.netPL)}{rm(mpl.netPL)}
                        </Text>
                      </Group>
                    </Group>
                  </Stack>
                </Paper>
              </Stack>
            )}

            {/* ── Stock value ───────────────────────────────────────────────── */}
            {m.stockQty > 0 && (
              <Stack gap="sm">
                <SectionLabel>Stock on Hand</SectionLabel>
                <Paper withBorder p="md" radius="md">
                  <Stack gap="xs">
                    <MetaRow label="Cards in stock" value={`${m.stockQty} pcs`} />
                    <Divider variant="dashed" />
                    <MetaRow label="Value at cost"   value={rm(m.stockCost)} />
                    <MetaRow label="Value at market" value={rm(m.stockMarket)} />
                    <Divider />
                    <Group justify="space-between">
                      <Text size="sm" fw={600}>Unrealized</Text>
                      <Group gap={4}>
                        <ThemeIcon size="xs" variant="transparent" color={netColor(m.unrealizedGain)}>
                          <TrendIcon value={m.unrealizedGain} />
                        </ThemeIcon>
                        <Text size="sm" fw={700} c={netColor(m.unrealizedGain)}>
                          {sign(m.unrealizedGain)}{rm(m.unrealizedGain)}
                        </Text>
                      </Group>
                    </Group>
                  </Stack>
                </Paper>
              </Stack>
            )}

            {/* ── Per-event breakdown ───────────────────────────────────────── */}
            {eventBreakdown.length > 0 && (
              <ByEventSection
                breakdown={eventBreakdown}
                events={events}
                canEdit={canAddFunds}
                org={org}
                user={user}
              />
            )}

          </Stack>
        </ScrollArea>
      </Box>

      <AddFundsModal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        org={org}
        user={user}
        onAdded={addFundEntry}
      />
      <FundHistoryModal
        opened={historyOpen}
        onClose={() => setHistoryOpen(false)}
        funds={funds}
      />
      <FixedCostsModal
        opened={fixedCostsOpen}
        onClose={() => setFixedCostsOpen(false)}
        org={org}
        user={user}
      />
      <ExportPLModal
        opened={exportOpen}
        onClose={() => setExportOpen(false)}
        miscCosts={miscCosts}
        fixedCosts={fixedCosts}
        events={events}
        monthlyPL={monthlyPL}
      />
    </>
  );
}
