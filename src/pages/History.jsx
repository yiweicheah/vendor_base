import { useState, useMemo, useRef } from 'react';
import {
  Box, ScrollArea, Stack, Text, Center, ThemeIcon,
  Group, ActionIcon, Select, Modal, TextInput, Button, Pagination,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconHistory, IconLayoutList, IconLayoutGrid, IconPencil, IconTrash } from '@tabler/icons-react';
import useOrgStore from '../store/orgStore';
import TransactionCard from '../components/History/TransactionCard';
import { updateEvent as updateEventDb, deleteEvent as deleteEventDb } from '../lib/db';

function formatEventDates(startsAt, endsAt) {
  if (!startsAt) return null;
  const fmt = (ts) => new Date(ts).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
  if (!endsAt) return fmt(startsAt);
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  return s.toDateString() === e.toDateString() ? fmt(startsAt) : `${fmt(startsAt)} – ${fmt(endsAt)}`;
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

const PAGE_SIZE_LIST = 20;
const PAGE_SIZE_GRID = 12;

const SORT_OPTIONS = [
  { value: 'date',  label: 'Date' },
  { value: 'total', label: 'Total value' },
  { value: 'unit',  label: 'Unit price' },
];

const TYPE_FILTER_OPTIONS = [
  { value: 'all',   label: 'All types' },
  { value: 'BUY',   label: 'Buy' },
  { value: 'SELL',  label: 'Sell' },
  { value: 'TRADE', label: 'Trade' },
];

function lineTotal(lines) {
  return lines.reduce((s, l) => s + (l.unitPriceMyr || 0) * l.qty, 0);
}

function maxUnitPrice(lines) {
  return lines.reduce((m, l) => Math.max(m, l.unitPriceMyr || 0), 0);
}

function classifyTx(tx) {
  if (tx.notes?.startsWith('Stock import') || tx.notes?.startsWith('Stock addition')) return 'BUY';
  const lines    = tx.transactionLines ?? [];
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


export default function History() {
  const transactions  = useOrgStore((s) => s.transactions);
  const events        = useOrgStore((s) => s.events);
  const role          = useOrgStore((s) => s.role);
  const updateEventInStore = useOrgStore((s) => s.updateEvent);
  const removeEventInStore = useOrgStore((s) => s.removeEvent);
  const [view, setViewRaw]              = useState(() => localStorage.getItem('history_view')            ?? 'list');
  const [sort, setSortRaw]              = useState(() => localStorage.getItem('history_sort')            ?? 'date');
  const [eventFilter, setFilterRaw]     = useState(() => localStorage.getItem('history_event_filter')   ?? 'all');
  const [typeFilter, setTypeFilterRaw]  = useState(() => localStorage.getItem('history_type_filter')    ?? 'all');
  const [creatorFilter, setCreatorFilterRaw]   = useState(() => localStorage.getItem('history_creator_filter')  ?? 'all');
  const [paymentFilter, setPaymentFilterRaw]   = useState(() => localStorage.getItem('history_payment_filter')  ?? 'all');
  const [page, setPage] = useState(1);
  const [eventSearch, setEventSearch] = useState('');
  const [editingEvent, setEditingEvent] = useState(null);
  const viewportRef = useRef(null);
  const [deletingEvent, setDeletingEvent] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const canEdit = role === 'owner' || role === 'admin';

  function setView(v)          { setViewRaw(v);           localStorage.setItem('history_view', v); }
  function setSort(v)          { setSortRaw(v);           localStorage.setItem('history_sort', v);           setPage(1); }
  function setEventFilter(v)   { setFilterRaw(v);         localStorage.setItem('history_event_filter', v);   setPage(1); }
  function setTypeFilter(v)    { setTypeFilterRaw(v);     localStorage.setItem('history_type_filter', v);    setPage(1); }
  function setCreatorFilter(v) { setCreatorFilterRaw(v);  localStorage.setItem('history_creator_filter', v); setPage(1); }
  function setPaymentFilter(v) { setPaymentFilterRaw(v);  localStorage.setItem('history_payment_filter', v); setPage(1); }

  async function handleDeleteConfirm() {
    if (!deletingEvent) return;
    setDeleteLoading(true);
    try {
      await deleteEventDb(deletingEvent.id);
      removeEventInStore(deletingEvent.id);
      setEventFilter('all');
      setDeletingEvent(null);
      notifications.show({ message: 'Event deleted.', color: 'green', autoClose: 2000 });
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

  const creatorOptions = useMemo(() => {
    const names = [...new Set(transactions.map((tx) => tx.createdBy?.displayName).filter(Boolean))].sort();
    return [{ value: 'all', label: 'All members' }, ...names.map((n) => ({ value: n, label: n }))];
  }, [transactions]);

  const paymentOptions = useMemo(() => {
    const methods = [...new Set(transactions.map((tx) => tx.paymentMethod).filter(Boolean))].sort();
    return [{ value: 'all', label: 'All payments' }, ...methods.map((m) => ({ value: m, label: m }))];
  }, [transactions]);

  const selectedEvent = useMemo(
    () => (eventFilter !== 'all' && eventFilter !== '__none__') ? events.find((e) => e.id === eventFilter) ?? null : null,
    [eventFilter, events],
  );

  const sorted = useMemo(() => {
    const copy = [...transactions];
    if (sort === 'total') {
      copy.sort((a, b) => {
        const aLines = a.transactionLines ?? [];
        const bLines = b.transactionLines ?? [];
        return lineTotal(bLines) - lineTotal(aLines);
      });
    } else if (sort === 'unit') {
      copy.sort((a, b) => {
        const aLines = a.transactionLines ?? [];
        const bLines = b.transactionLines ?? [];
        return maxUnitPrice(bLines) - maxUnitPrice(aLines);
      });
    } else {
      copy.sort((a, b) => b.createdAt - a.createdAt);
    }
    return copy;
  }, [transactions, sort]);

  const displayed = useMemo(() => {
    let result = sorted;
    if (eventFilter === '__none__') result = result.filter((tx) => tx.event == null);
    else if (eventFilter !== 'all') result = result.filter((tx) => tx.event?.id === eventFilter);
    if (typeFilter    !== 'all') result = result.filter((tx) => classifyTx(tx) === typeFilter);
    if (creatorFilter !== 'all') result = result.filter((tx) => (tx.createdBy?.displayName ?? null) === creatorFilter);
    if (paymentFilter !== 'all') result = result.filter((tx) => tx.paymentMethod === paymentFilter);
    return result;
  }, [sorted, eventFilter, typeFilter, creatorFilter, paymentFilter]);


  const pageSize   = view === 'grid' ? PAGE_SIZE_GRID : PAGE_SIZE_LIST;
  const totalPages = Math.ceil(displayed.length / pageSize);
  const paged      = displayed.slice((page - 1) * pageSize, page * pageSize);

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
      {editingEvent && (
        <EditEventModal
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSaved={(patch) => updateEventInStore(editingEvent.id, patch)}
        />
      )}
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

          {displayed.length === 0 ? (
            <Center py="xl">
              <Text c="dimmed" size="sm">No transactions for this filter</Text>
            </Center>
          ) : (
            <Stack gap="sm">
              {paged.map((tx) => (
                <TransactionCard key={tx.id} tx={tx} view={view} />
              ))}
              {totalPages > 1 && (
                <Pagination
                  value={page}
                  onChange={(p) => { setPage(p); viewportRef.current?.scrollTo({ top: 0 }); }}
                  total={totalPages}
                  size="sm"
                  color="violet"
                />
              )}
            </Stack>
          )}

        </Stack>
      </ScrollArea>
    </Box>
  );
}
