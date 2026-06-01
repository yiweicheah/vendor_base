import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Box, ScrollArea, Stack, Text, Center, ThemeIcon, Loader, LoadingOverlay,
  Group, ActionIcon, Select, Modal, TextInput, Button, Pagination,
  Paper, Divider, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconHistory, IconLayoutList, IconLayoutGrid, IconPencil, IconTrash, IconReceipt, IconInfoCircle, IconX } from '@tabler/icons-react';
import useOrgStore from '../store/orgStore';
import useAuthStore from '../store/authStore';
import TransactionCard from '../components/History/TransactionCard';
import EventMiscCostsModal from '../components/shared/EventMiscCostsModal';
import {
  updateEvent as updateEventDb,
  deleteEvent as deleteEventDb,
  loadTransactionsPage,
  loadHistoryFilterOptions,
  loadEventBreakdown,
} from '../lib/db';
import { rm } from '../lib/format';

function sign(n) { return n > 0.005 ? '+' : n < -0.005 ? '−' : ''; }
function netColor(n) { return n > 0.005 ? 'green.4' : n < -0.005 ? 'red.4' : 'dimmed'; }

function formatEventDates(startsAt, endsAt) {
  if (!startsAt) return null;
  const fmt = (ts) => new Date(ts).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
  if (!endsAt) return fmt(startsAt);
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  return s.toDateString() === e.toDateString() ? fmt(startsAt) : `${fmt(startsAt)} – ${fmt(endsAt)}`;
}

// Date-range filter helpers. ymd() formats a Date as a local YYYY-MM-DD (the
// `T - offset` shift avoids the UTC off-by-one that toISOString() alone causes
// for users west/east of UTC). toStartTs/toEndTs turn a date-input string into
// an ISO timestamptz interpreted in local tz — `${d}T..` (with a time part) is
// parsed as local, unlike a bare 'YYYY-MM-DD' which is parsed as UTC.
const ymd = (d) => { const t = d.getTimezoneOffset() * 60000; return new Date(d - t).toISOString().slice(0, 10); };
const toStartTs = (d) => (d ? new Date(`${d}T00:00:00`).toISOString()     : null);
const toEndTs   = (d) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : null);

// Short label for an active range, shown on the date-scoped Event Summary title.
// e.g. "1–7 Jun" · one-sided: "From 1 Jun" / "Until 7 Jun".
function formatRangeLabel(start, end) {
  const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
  if (start && end) return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  if (end)   return `Until ${fmt(end)}`;
  return '';
}

// Quick-range presets. range() returns [fromYmd, toYmd] computed at call time,
// used both to apply the range and to detect which preset (if any) the current
// selection matches, so its button can render highlighted.
const DATE_PRESETS = [
  { key: 'today',     label: 'Today',     range: () => { const d = new Date(); return [ymd(d), ymd(d)]; } },
  { key: 'yesterday', label: 'Yesterday', range: () => { const d = new Date(); d.setDate(d.getDate() - 1); return [ymd(d), ymd(d)]; } },
  { key: '7d',    label: '7d',    range: () => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - 6);  return [ymd(s), ymd(e)]; } },
  { key: '30d',   label: '30d',   range: () => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - 29); return [ymd(s), ymd(e)]; } },
  { key: 'month', label: 'Month', range: () => { const e = new Date(); const s = new Date(e.getFullYear(), e.getMonth(), 1); return [ymd(s), ymd(e)]; } },
];

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
      notifications.show({ message: 'Event updated.', color: 'green' });
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

const PAGE_SIZE_LIST = 20;
const PAGE_SIZE_GRID = 12;

const SORT_OPTIONS = [
  { value: 'date',  label: 'Date' },
  { value: 'total', label: 'Total value' },
];

const TYPE_FILTER_OPTIONS = [
  { value: 'all',   label: 'All types' },
  { value: 'BUY',   label: 'Buy' },
  { value: 'SELL',  label: 'Sell' },
  { value: 'TRADE', label: 'Trade' },
];


export default function History() {
  const org                = useOrgStore((s) => s.org);
  const events             = useOrgStore((s) => s.events);
  const role               = useOrgStore((s) => s.role);
  const eventBreakdown     = useOrgStore((s) => s.eventBreakdown);
  const historyRev         = useOrgStore((s) => s.historyRev);
  const filterOptionsRev   = useOrgStore((s) => s.filterOptionsRev);
  const updateEventInStore = useOrgStore((s) => s.updateEvent);
  const removeEventInStore = useOrgStore((s) => s.removeEvent);
  const user               = useAuthStore((s) => s.user);
  const [view, setViewRaw]              = useState(() => localStorage.getItem('history_view')            ?? 'list');
  const [sort, setSortRaw]              = useState(() => {
    const stored = localStorage.getItem('history_sort');
    return SORT_OPTIONS.some((o) => o.value === stored) ? stored : 'date';
  });
  const [eventFilter, setFilterRaw]     = useState(() => localStorage.getItem('history_event_filter')   ?? 'all');
  const [typeFilter, setTypeFilterRaw]  = useState(() => localStorage.getItem('history_type_filter')    ?? 'all');
  const [creatorFilter, setCreatorFilterRaw]   = useState(() => localStorage.getItem('history_creator_filter')  ?? 'all');
  const [paymentFilter, setPaymentFilterRaw]   = useState(() => localStorage.getItem('history_payment_filter')  ?? 'all');
  // Date range is session-only (intentionally not persisted) so a saved window
  // can't silently hide newer transactions on a later visit.
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');
  const [page, setPage] = useState(1);
  const [eventSearch, setEventSearch] = useState('');
  const [editingEvent, setEditingEvent] = useState(null);
  const viewportRef = useRef(null);
  const [deletingEvent, setDeletingEvent] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [miscCostsEvent, setMiscCostsEvent] = useState(null);

  const [pageData, setPageData] = useState({ rows: [], totalCount: 0 });
  const [pageLoading, setPageLoading] = useState(false);
  const [filterOptions, setFilterOptions] = useState({ creators: [], paymentMethods: [], hasAny: false });
  // null until first successful/failed load for the current org — gates the initial spinner only
  const [optionsLoadedForOrg, setOptionsLoadedForOrg] = useState(null);
  // Date-scoped event breakdown — only fetched while a date range is active (see
  // effect below). The org-wide store breakdown stays untouched (Dashboard reads it).
  const [scopedBreakdown, setScopedBreakdown] = useState([]);

  const canEdit = role === 'owner' || role === 'admin';
  const pageSize = view === 'grid' ? PAGE_SIZE_GRID : PAGE_SIZE_LIST;
  const isDateScoped = !!(startDate || endDate);

  function setView(v)          { setViewRaw(v);           localStorage.setItem('history_view', v);           setPage(1); }
  function setSort(v)          { setSortRaw(v);           localStorage.setItem('history_sort', v);           setPage(1); }
  function setEventFilter(v)   { setFilterRaw(v);         localStorage.setItem('history_event_filter', v);   setPage(1); }
  function setTypeFilter(v)    { setTypeFilterRaw(v);     localStorage.setItem('history_type_filter', v);    setPage(1); }
  function setCreatorFilter(v) { setCreatorFilterRaw(v);  localStorage.setItem('history_creator_filter', v); setPage(1); }
  function setPaymentFilter(v) { setPaymentFilterRaw(v);  localStorage.setItem('history_payment_filter', v); setPage(1); }
  function changeStart(v)      { setStartDate(v);  setPage(1); }
  function changeEnd(v)        { setEndDate(v);    setPage(1); }
  function clearDates()        { setStartDate(''); setEndDate(''); setPage(1); }
  function applyPreset(from, to) { setStartDate(from); setEndDate(to); setPage(1); }

  // ─── Server-side data fetching ─────────────────────────────────────────────
  const orgId = org?.id ?? null;

  const prevOrgIdRef = useRef(null);
  useEffect(() => {
    if (prevOrgIdRef.current !== null && prevOrgIdRef.current !== orgId) {
      setFilterRaw('all');        localStorage.setItem('history_event_filter',   'all');
      setTypeFilterRaw('all');    localStorage.setItem('history_type_filter',    'all');
      setCreatorFilterRaw('all'); localStorage.setItem('history_creator_filter', 'all');
      setPaymentFilterRaw('all'); localStorage.setItem('history_payment_filter', 'all');
      setStartDate(''); setEndDate('');
      setPage(1);
    }
    prevOrgIdRef.current = orgId;
  }, [orgId]); // eslint-disable-line

  // Filter options: refetch on org change or when creators/payment methods could have changed.
  // Uses filterOptionsRev (not historyRev) so inline edits (notes, event tag, line prices)
  // don't trigger a redundant DB round-trip.
  // The full-page spinner only blocks on the very first load per org; subsequent refetches
  // happen silently in the background.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    loadHistoryFilterOptions(orgId)
      .then((opts) => { if (!cancelled) setFilterOptions(opts); })
      .catch((err) => {
        if (cancelled) return;
        console.error('loadHistoryFilterOptions error:', err);
        notifications.show({ title: 'Failed to load history', message: err.message, color: 'red' });
      })
      .finally(() => { if (!cancelled) setOptionsLoadedForOrg(orgId); });
    return () => { cancelled = true; };
  }, [orgId, filterOptionsRev]);

  // Page: refetch on any filter/sort/page change or transaction-set mutation.
  // If the underlying count dropped (e.g. last item on the current page deleted),
  // clamp `page` to the new total in the same setState batch as setPageData.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setPageLoading(true);
    loadTransactionsPage(orgId, {
      eventId:       eventFilter === 'all' ? null : eventFilter,
      type:          typeFilter   === 'all' ? null : typeFilter,
      creatorName:   creatorFilter === 'all' ? null : creatorFilter,
      paymentMethod: paymentFilter === 'all' ? null : paymentFilter,
      sort,
      offset:        (page - 1) * pageSize,
      limit:         pageSize,
      dateStart:     toStartTs(startDate),
      dateEnd:       toEndTs(endDate),
    })
      .then((result) => {
        if (cancelled) return;
        setPageData(result);
        const newTotal = Math.max(1, Math.ceil(result.totalCount / pageSize));
        if (page > newTotal) setPage(newTotal);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('loadTransactionsPage error:', err);
        notifications.show({ title: 'Failed to load transactions', message: err.message, color: 'red' });
      })
      .finally(() => { if (!cancelled) setPageLoading(false); });
    return () => { cancelled = true; };
  }, [orgId, eventFilter, typeFilter, creatorFilter, paymentFilter, startDate, endDate, sort, page, pageSize, historyRev]);

  // Date-scoped event breakdown: fetch only while a range is active, keyed on the
  // range (not eventFilter — the RPC returns all events; the selected row is picked
  // in selectedEventBreakdown). When no range, the store breakdown is used instead.
  useEffect(() => {
    // No cleanup-clear needed: selectedEventBreakdown only reads scopedBreakdown
    // while isDateScoped, so a stale value left here when the range clears is unread.
    if (!orgId || !isDateScoped) return;
    let cancelled = false;
    loadEventBreakdown(orgId, { dateStart: toStartTs(startDate), dateEnd: toEndTs(endDate) })
      .then((rows) => { if (!cancelled) setScopedBreakdown(rows); })
      .catch((err) => {
        if (cancelled) return;
        console.error('loadEventBreakdown (scoped) error:', err);
        notifications.show({ title: 'Failed to load summary', message: err.message, color: 'red' });
      });
    return () => { cancelled = true; };
  }, [orgId, isDateScoped, startDate, endDate, historyRev]);

  const totalPages = Math.max(1, Math.ceil(pageData.totalCount / pageSize));

  async function handleDeleteConfirm() {
    if (!deletingEvent) return;
    setDeleteLoading(true);
    try {
      await deleteEventDb(deletingEvent.id);
      removeEventInStore(deletingEvent.id);
      setEventFilter('all');
      setDeletingEvent(null);
      notifications.show({ message: 'Event deleted.', color: 'green' });
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' });
    } finally {
      setDeleteLoading(false);
    }
  }

  const eventOptions = useMemo(() => [
    { value: 'all',      label: 'All events' },
    { value: '__none__', label: 'Walk-ins' },
    ...events.map((e) => ({ value: e.id, label: e.name, startsAt: e.startsAt, endsAt: e.endsAt })),
  ], [events]);

  // If the user previously selected a creator/payment that's no longer present
  // in the org's history (e.g. the last matching tx was deleted), keep the chip
  // in the dropdown so the Mantine Select doesn't render an invalid value. The
  // server will simply return 0 rows; the user can switch back to 'all'.
  const creatorOptions = useMemo(() => {
    const opts = [{ value: 'all', label: 'All members' }, ...filterOptions.creators.map((n) => ({ value: n, label: n }))];
    if (creatorFilter !== 'all' && !filterOptions.creators.includes(creatorFilter)) {
      opts.push({ value: creatorFilter, label: creatorFilter });
    }
    return opts;
  }, [filterOptions.creators, creatorFilter]);

  const paymentOptions = useMemo(() => {
    const opts = [{ value: 'all', label: 'All payments' }, ...filterOptions.paymentMethods.map((m) => ({ value: m, label: m }))];
    if (paymentFilter !== 'all' && !filterOptions.paymentMethods.includes(paymentFilter)) {
      opts.push({ value: paymentFilter, label: paymentFilter });
    }
    return opts;
  }, [filterOptions.paymentMethods, paymentFilter]);

  // Which preset (if any) the current range matches — drives button highlight.
  const activePreset = useMemo(() => {
    if (!startDate || !endDate) return null;
    return DATE_PRESETS.find((p) => { const [f, t] = p.range(); return f === startDate && t === endDate; })?.key ?? null;
  }, [startDate, endDate]);

  const selectedEvent = useMemo(
    () => (eventFilter !== 'all' && eventFilter !== '__none__') ? events.find((e) => e.id === eventFilter) ?? null : null,
    [eventFilter, events],
  );

  const selectedEventBreakdown = useMemo(() => {
    if (eventFilter === 'all') return null;
    const source = isDateScoped ? scopedBreakdown : eventBreakdown;
    return source.find((e) => e.id === eventFilter) ?? {
      id: eventFilter, totalOut: 0, totalIn: 0,
      grossProfit: 0, profitComplete: true, miscCostTotal: 0, netPL: 0,
    };
  }, [eventFilter, eventBreakdown, scopedBreakdown, isDateScoped]);

  const handleRowsScrollTop = useCallback(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, []);

  if (optionsLoadedForOrg !== orgId) {
    return (
      <Center h="100%">
        <Loader color="violet" size="md" />
      </Center>
    );
  }

  if (!filterOptions.hasAny && events.length === 0) {
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
      {editingEvent && (
        <EditEventModal
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSaved={(patch) => updateEventInStore(editingEvent.id, patch)}
        />
      )}
      <EventMiscCostsModal
        event={miscCostsEvent}
        opened={!!miscCostsEvent}
        onClose={() => setMiscCostsEvent(null)}
        org={org}
        user={user}
      />
      <Modal
        opened={!!deletingEvent}
        onClose={() => setDeletingEvent(null)}
        title="Delete event"
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Delete <strong>{deletingEvent?.name}</strong>? This cannot be undone. Transactions tagged to this event will remain but lose their event link.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" size="sm" onClick={() => setDeletingEvent(null)}>
              Cancel
            </Button>
            <Button color="red" size="sm" loading={deleteLoading} onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>

      <ScrollArea style={{ flex: 1 }} p="md" viewportRef={viewportRef}>
        <Stack gap="sm" pb="md">

          <Group justify="flex-end">
            {events.length > 0 && (
              <Group gap={4} wrap="nowrap">
                <Select
                  data={eventOptions}
                  value={eventFilter}
                  onChange={setEventFilter}
                  size="xs"
                  w={180}
                  allowDeselect={false}
                  searchable
                  searchValue={eventSearch}
                  onSearchChange={setEventSearch}
                  onDropdownOpen={() => setEventSearch('')}
                  renderOption={({ option }) => {
                    const date = option.startsAt
                      ? formatEventDates(option.startsAt, option.endsAt)
                      : null;
                    return (
                      <Stack gap={0}>
                        <Text size="xs">{option.label}</Text>
                        {date && <Text size="xs" c="dimmed">{date}</Text>}
                      </Stack>
                    );
                  }}
                />
                {canEdit && selectedEvent && (
                  <>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="sm"
                      title="Edit event"
                      onClick={() => setEditingEvent(selectedEvent)}
                    >
                      <IconPencil size={14} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="sm"
                      title="Delete event"
                      onClick={() => setDeletingEvent(selectedEvent)}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </>
                )}
              </Group>
            )}
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

          {selectedEventBreakdown && (
            <Paper withBorder p="sm" radius="md">
              <Stack gap="xs">
                <Group justify="space-between" wrap="nowrap">
                  <Group gap={6} wrap="nowrap" align="baseline">
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.08em' }}>
                      Event Summary
                    </Text>
                    {isDateScoped && (
                      <Text size="xs" c="dimmed">· {formatRangeLabel(startDate, endDate)}</Text>
                    )}
                  </Group>
                  {!isDateScoped && canEdit && selectedEventBreakdown.id !== '__none__' && (
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="xs"
                      title="Misc costs"
                      onClick={() => setMiscCostsEvent(events.find((e) => e.id === selectedEventBreakdown.id) ?? null)}
                    >
                      <IconReceipt size={11} />
                    </ActionIcon>
                  )}
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Sales</Text>
                  <Text size="xs">{rm(selectedEventBreakdown.totalOut)}</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Purchases</Text>
                  <Text size="xs" c="dimmed">−{rm(selectedEventBreakdown.totalIn)}</Text>
                </Group>
                <Group justify="space-between">
                  <Group gap={4} wrap="nowrap">
                    <Text size="xs" c="dimmed">
                      Est. gross profit{!selectedEventBreakdown.profitComplete ? ' ~' : ''}
                    </Text>
                    <Tooltip
                      label="Gross profit is estimated — COGS may be incorrect if a previous import or purchase price was changed after the sale."
                      multiline
                      w={240}
                      withArrow
                      events={{ hover: true, focus: true, touch: true }}
                    >
                      <IconInfoCircle size={12} style={{ color: 'var(--mantine-color-dimmed)', cursor: 'default', flexShrink: 0 }} />
                    </Tooltip>
                  </Group>
                  <Text size="xs" fw={500} c={netColor(selectedEventBreakdown.grossProfit)}>
                    {sign(selectedEventBreakdown.grossProfit)}{rm(selectedEventBreakdown.grossProfit)}
                  </Text>
                </Group>
                {/* Misc costs are flat per-event (no date), so they're hidden when a
                    range is active — Net P&L depends on them, so it's hidden too. */}
                {!isDateScoped && (
                  <>
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">Misc costs</Text>
                      <Text size="xs" c="dimmed">−{rm(selectedEventBreakdown.miscCostTotal)}</Text>
                    </Group>
                    <Divider variant="dashed" />
                    <Group justify="space-between">
                      <Group gap={4} wrap="nowrap">
                        <Text size="xs" fw={600}>Est. Net P&L</Text>
                        <Tooltip
                          label="Net P&L is estimated — COGS may be incorrect if a previous import or purchase price was changed after the sale."
                          multiline
                          w={240}
                          withArrow
                          events={{ hover: true, focus: true, touch: true }}
                        >
                          <IconInfoCircle size={12} style={{ color: 'var(--mantine-color-dimmed)', cursor: 'default', flexShrink: 0 }} />
                        </Tooltip>
                      </Group>
                      <Text size="xs" fw={600} c={netColor(selectedEventBreakdown.netPL)}>
                        {sign(selectedEventBreakdown.netPL)}{rm(selectedEventBreakdown.netPL)}
                      </Text>
                    </Group>
                  </>
                )}
              </Stack>
            </Paper>
          )}

          <Group gap="xs">
            <Select
              data={TYPE_FILTER_OPTIONS}
              value={typeFilter}
              onChange={setTypeFilter}
              size="xs"
              w={110}
              allowDeselect={false}
            />
            {creatorOptions.length > 2 && (
              <Select
                data={creatorOptions}
                value={creatorFilter}
                onChange={setCreatorFilter}
                size="xs"
                w={140}
                allowDeselect={false}
              />
            )}
            {paymentOptions.length > 1 && (
              <Select
                data={paymentOptions}
                value={paymentFilter}
                onChange={setPaymentFilter}
                size="xs"
                w={150}
                allowDeselect={false}
              />
            )}
          </Group>

          <Group gap="xs" wrap="wrap" align="flex-end">
            <Button.Group>
              {DATE_PRESETS.map((p) => {
                const active = activePreset === p.key;
                return (
                  <Button
                    key={p.key}
                    variant={active ? 'filled' : 'default'}
                    color={active ? 'violet' : undefined}
                    size="xs"
                    onClick={() => applyPreset(...p.range())}
                  >
                    {p.label}
                  </Button>
                );
              })}
            </Button.Group>
            <TextInput
              type="date"
              aria-label="From date"
              value={startDate}
              max={endDate || undefined}
              onChange={(e) => changeStart(e.currentTarget.value)}
              size="xs"
              w={150}
              styles={startDate ? { input: { borderColor: 'var(--mantine-color-violet-6)' } } : undefined}
            />
            <TextInput
              type="date"
              aria-label="To date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => changeEnd(e.currentTarget.value)}
              size="xs"
              w={150}
              styles={endDate ? { input: { borderColor: 'var(--mantine-color-violet-6)' } } : undefined}
            />
            {(startDate || endDate) && (
              <ActionIcon variant="subtle" color="gray" size="sm" title="Clear date range" onClick={clearDates}>
                <IconX size={14} />
              </ActionIcon>
            )}
          </Group>

          {pageData.rows.length === 0 ? (
            <Center py="xl">
              {pageLoading
                ? <Loader color="violet" size="sm" />
                : <Text c="dimmed" size="sm">No transactions for this filter</Text>}
            </Center>
          ) : (
            <Box pos="relative" mih={120}>
              <LoadingOverlay
                visible={pageLoading}
                zIndex={2}
                overlayProps={{ blur: 1, backgroundOpacity: 0.35 }}
                loaderProps={{ color: 'violet', size: 'sm' }}
              />
              <Stack gap="sm">
                {pageData.rows.map((tx) => (
                  <TransactionCard key={tx.id} tx={tx} view={view} />
                ))}
                {totalPages > 1 && (
                  <Pagination
                    value={page}
                    onChange={(p) => { setPage(p); handleRowsScrollTop(); }}
                    total={totalPages}
                    size="sm"
                    color="violet"
                  />
                )}
              </Stack>
            </Box>
          )}

        </Stack>
      </ScrollArea>
    </Box>
  );
}
