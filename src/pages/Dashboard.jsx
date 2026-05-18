import { useMemo, useState } from 'react';
import {
  Box, ScrollArea, Stack, Paper, Group, Text, Divider,
  ThemeIcon, Center, Button, Modal, NumberInput, TextInput, ActionIcon,
  Select, Pagination,
} from '@mantine/core';
import {
  IconChartBar, IconTrendingUp, IconTrendingDown, IconMinus, IconPlus, IconPencil,
  IconChevronDown, IconChevronUp, IconSearch, IconArrowUp, IconArrowDown,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import useOrgStore from '../store/orgStore';
import useAuthStore from '../store/authStore';
import { computeMetrics } from '../lib/analytics';
import { createFundEntry, updateEvent as updateEventDb } from '../lib/db';

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

// ─── Edit Event modal ─────────────────────────────────────────────────────────

function EditEventModal({ event, onClose, onSaved }) {
  const toDateInput = (ts) => ts ? new Date(ts).toISOString().slice(0, 10) : '';
  const toTs        = (d)  => d  ? new Date(d).toISOString() : null;

  const [name,      setName]      = useState(event?.name      ?? '');
  const [location,  setLocation]  = useState(event?.location  ?? '');
  const [startDate, setStartDate] = useState(() => toDateInput(event?.startsAt));
  const [endDate,   setEndDate]   = useState(() => toDateInput(event?.endsAt));
  const [loading,   setLoading]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !event?.id) return;
    setLoading(true);
    try {
      const patch = {
        name:     name.trim(),
        location: location.trim() || null,
        startsAt: toTs(startDate),
        endsAt:   toTs(endDate),
      };
      await updateEventDb({ eventId: event.id, ...patch });
      onSaved(patch);
      onClose();
      notifications.show({ message: 'Event updated.', color: 'green', autoClose: 2000 });
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal opened={!!event} onClose={onClose} title="Edit event" size="sm">
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <TextInput
            label="Event name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            required
            autoFocus
          />
          <TextInput
            label="Location"
            placeholder="KLCC Convention Centre"
            value={location}
            onChange={(e) => setLocation(e.currentTarget.value)}
          />
          <Group grow gap="sm">
            <TextInput
              label="Start date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.currentTarget.value)}
            />
            <TextInput
              label="End date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.currentTarget.value)}
            />
          </Group>
          <Button type="submit" loading={loading} disabled={!name.trim()} mt="xs">
            Save
          </Button>
        </Stack>
      </form>
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
          <NumberInput
            label="Amount (MYR)"
            placeholder="0.00"
            leftSection={<Text size="xs" c="dimmed">RM</Text>}
            value={amount}
            onChange={setAmount}
            onBlur={(e) => { const v = parseFloat(e.currentTarget.value); if (!isNaN(v)) setAmount(v); }}
            decimalScale={2}
            fixedDecimalScale
            min={0.01}
            hideControls
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

// ─── By Event section ────────────────────────────────────────────────────────

const EVENT_SORT_OPTIONS = [
  { value: 'txCount',     label: 'Most transactions' },
  { value: 'grossProfit', label: 'Profit' },
  { value: 'netCash',     label: 'Net cash' },
  { value: 'cashIn',      label: 'Cash in' },
  { value: 'date',        label: 'Date' },
  { value: 'name',        label: 'Name' },
];
const PAGE_SIZE = 5;

function ByEventSection({ breakdown, events, canEdit, onEdit }) {
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
    <Stack gap="sm">
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
                          onClick={() => onEdit(events.find((e) => e.id === ev.id) ?? null)}
                        >
                          <IconPencil size={11} />
                        </ActionIcon>
                      )}
                    </Group>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Sales</Text>
                    <Text size="xs">{rm(ev.cashIn)}</Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Purchases</Text>
                    <Text size="xs" c="dimmed">−{rm(ev.cashOut)}</Text>
                  </Group>
                  {ev.cardSoldTotal > 0 && (
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">Gross profit{!ev.profitComplete ? ' ~' : ''}</Text>
                      <Text size="xs" fw={500} c={netColor(ev.grossProfit)}>
                        {sign(ev.grossProfit)}{rm(ev.grossProfit)}
                      </Text>
                    </Group>
                  )}
                  <Divider variant="dashed" />
                  <Group justify="space-between">
                    <Text size="xs" fw={600}>Net</Text>
                    <Text size="xs" fw={600} c={netColor(ev.netCash)}>
                      {sign(ev.netCash)}{rm(ev.netCash)}
                    </Text>
                  </Group>
                </Stack>
              </Paper>
            ))
          )}

          {totalPages > 1 && (
            <Group justify="center" mt="xs">
              <Pagination total={totalPages} value={safePage} onChange={setPage} size="xs" />
            </Group>
          )}
        </Stack>
      )}
    </Stack>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const transactions  = useOrgStore((s) => s.transactions);
  const funds         = useOrgStore((s) => s.funds);
  const org           = useOrgStore((s) => s.org);
  const role          = useOrgStore((s) => s.role);
  const events        = useOrgStore((s) => s.events);
  const addFundEntry  = useOrgStore((s) => s.addFundEntry);
  const updateEvent   = useOrgStore((s) => s.updateEvent);
  const user          = useAuthStore((s) => s.user);

  const [modalOpen,    setModalOpen]    = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);

  const m            = useMemo(() => computeMetrics(transactions), [transactions]);
  const totalFunds   = useMemo(() => funds.reduce((sum, f) => sum + (f.amountMyr ?? 0), 0), [funds]);
  const cashOnHand   = totalFunds + m.netCash;
  const canAddFunds  = role === 'owner' || role === 'admin';

  const hasContent = transactions.length > 0 || funds.length > 0;

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
                  <MetaRow label="Funds deposited" value={rm(totalFunds)} />
                  <MetaRow
                    label="Net from trades"
                    value={`${sign(m.netCash)}${rm(m.netCash)}`}
                    valueColor={netColor(m.netCash)}
                  />
                  <Divider />
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>Cash on hand</Text>
                    <Group gap={4}>
                      <ThemeIcon size="xs" variant="transparent" color={netColor(cashOnHand)}>
                        <TrendIcon value={cashOnHand} />
                      </ThemeIcon>
                      <Text size="sm" fw={700} c={netColor(cashOnHand)}>
                        {sign(cashOnHand)}{rm(cashOnHand)}
                      </Text>
                    </Group>
                  </Group>
                </Stack>
              </Paper>
            </Stack>

            {/* ── P&L Summary ──────────────────────────────────────────────── */}
            {transactions.length > 0 && (
              <Stack gap="sm">
                <SectionLabel>P&L Summary</SectionLabel>
                <Paper withBorder p="md" radius="md">
                  <Stack gap="xs">
                    <MetaRow label="Transactions"  value={m.txCount} />
                    <MetaRow label="Cards bought"  value={`${m.cardBuyQty} pcs`} />
                    <MetaRow label="Cards sold"    value={`${m.cardSellQty} pcs`} />
                    <Divider variant="dashed" />
                    <MetaRow label="Sales"     value={rm(m.cashIn)} />
                    <MetaRow label="Purchases" value={`−${rm(m.cashOut)}`} />
                    {m.cardSoldTotal > 0 && (
                      <MetaRow
                        label={`Gross profit${!m.profitComplete ? ' ~' : ''}`}
                        value={`${sign(m.grossProfit)}${rm(m.grossProfit)}`}
                        valueColor={netColor(m.grossProfit)}
                      />
                    )}
                    <Divider />
                    <Group justify="space-between">
                      <Text size="sm" fw={600}>Net cash</Text>
                      <Group gap={4}>
                        <ThemeIcon size="xs" variant="transparent" color={netColor(m.netCash)}>
                          <TrendIcon value={m.netCash} />
                        </ThemeIcon>
                        <Text size="sm" fw={700} c={netColor(m.netCash)}>
                          {sign(m.netCash)}{rm(m.netCash)}
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
            {m.eventBreakdown.length > 0 && (
              <ByEventSection
                breakdown={m.eventBreakdown}
                events={events}
                canEdit={canAddFunds}
                onEdit={setEditingEvent}
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
      {editingEvent && (
        <EditEventModal
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSaved={(patch) => updateEvent(editingEvent.id, patch)}
        />
      )}
    </>
  );
}
