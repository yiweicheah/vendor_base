import { useState } from 'react';
import {
  Group, Text, ActionIcon, Modal, Stack, Radio,
  TextInput, Button, Divider, Box, UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconCalendarEvent, IconX, IconPlus, IconChevronDown } from '@tabler/icons-react';
import { createEvent } from '../../lib/db';
import useOrgStore from '../../store/orgStore';
import useAuthStore from '../../store/authStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatEventDates(startsAt, endsAt) {
  if (!startsAt) return null;
  const fmt = (ts) =>
    new Date(ts).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
  if (!endsAt) return fmt(startsAt);
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  return s.toDateString() === e.toDateString()
    ? fmt(startsAt)
    : `${fmt(startsAt)} – ${fmt(endsAt)}`;
}

// ─── Create-event mini-form ───────────────────────────────────────────────────

function CreateEventForm({ onCreated }) {
  const org            = useOrgStore((s) => s.org);
  const addEvent       = useOrgStore((s) => s.addEvent);
  const setActiveEventId = useOrgStore((s) => s.setActiveEventId);
  const user           = useAuthStore((s) => s.user);

  const [name,     setName]     = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate,   setEndDate]   = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !org?.id || !user?.dbId) return;
    setLoading(true);
    try {
      const toTs = (d) => d ? new Date(d).toISOString() : null;
      const result = await createEvent({
        orgId:       org.id,
        name:        name.trim(),
        location:    location.trim() || null,
        startsAt:    toTs(startDate),
        endsAt:      toTs(endDate),
        createdById: user.dbId,
      });
      const newId = result?.id;
      const newEvent = {
        id:       newId,
        name:     name.trim(),
        location: location.trim() || null,
        startsAt: toTs(startDate),
        endsAt:   toTs(endDate),
      };
      addEvent(newEvent);
      if (newId) {
        localStorage.setItem('selectedEventId', newId);
        setActiveEventId(newId);
      }
      onCreated();
      notifications.show({ message: 'Event created.', color: 'green', autoClose: 2000 });
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="sm">
        <TextInput
          label="Event name"
          placeholder="Card Fair KL 2025"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
          size="sm"
        />
        <TextInput
          label="Location"
          placeholder="KLCC Convention Centre"
          value={location}
          onChange={(e) => setLocation(e.currentTarget.value)}
          size="sm"
        />
        <Group grow gap="sm">
          <TextInput
            label="Start date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.currentTarget.value)}
            size="sm"
          />
          <TextInput
            label="End date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.currentTarget.value)}
            size="sm"
          />
        </Group>
        <Button type="submit" size="sm" loading={loading} disabled={!name.trim()}>
          Create & select
        </Button>
      </Stack>
    </form>
  );
}

// ─── Modal content ────────────────────────────────────────────────────────────

function EventPickerModal({ opened, onClose }) {
  const events          = useOrgStore((s) => s.events);
  const activeEventId   = useOrgStore((s) => s.activeEventId);
  const setActiveEventId = useOrgStore((s) => s.setActiveEventId);
  const [showCreate, setShowCreate] = useState(false);

  function select(id) {
    if (id) localStorage.setItem('selectedEventId', id);
    else localStorage.removeItem('selectedEventId');
    setActiveEventId(id);
    onClose();
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Select event" size="sm" padding="md">
      <Stack gap="sm">
        {/* None option */}
        <UnstyledButton onClick={() => select(null)}>
          <Group gap="sm">
            <Radio checked={activeEventId === null} onChange={() => {}} readOnly />
            <Text size="sm" c="dimmed">No event (walk-in)</Text>
          </Group>
        </UnstyledButton>

        {events.length > 0 && <Divider />}

        {/* Event list */}
        {events.map((ev) => (
          <UnstyledButton key={ev.id} onClick={() => select(ev.id)}>
            <Group gap="sm" wrap="nowrap">
              <Radio checked={activeEventId === ev.id} onChange={() => {}} readOnly style={{ flexShrink: 0 }} />
              <Stack gap={1} style={{ minWidth: 0 }}>
                <Text size="sm" fw={500} truncate>{ev.name}</Text>
                <Text size="xs" c="dimmed" truncate>
                  {[ev.location, formatEventDates(ev.startsAt, ev.endsAt)]
                    .filter(Boolean).join(' · ')}
                </Text>
              </Stack>
            </Group>
          </UnstyledButton>
        ))}

        <Divider />

        {/* Create toggle */}
        {!showCreate ? (
          <UnstyledButton onClick={() => setShowCreate(true)}>
            <Group gap="xs">
              <IconPlus size={14} color="var(--mantine-color-violet-4)" />
              <Text size="sm" c="violet.4">New event</Text>
            </Group>
          </UnstyledButton>
        ) : (
          <CreateEventForm onCreated={onClose} />
        )}
      </Stack>
    </Modal>
  );
}

// ─── Chip shown in the cart ───────────────────────────────────────────────────

export default function EventSelector() {
  const events          = useOrgStore((s) => s.events);
  const activeEventId   = useOrgStore((s) => s.activeEventId);
  const setActiveEventId = useOrgStore((s) => s.setActiveEventId);
  const [open, setOpen] = useState(false);

  const activeEvent = events.find((e) => e.id === activeEventId) ?? null;

  if (!activeEvent) {
    return (
      <>
        <UnstyledButton onClick={() => setOpen(true)} style={{ width: '100%' }}>
          <Group gap="xs" px="xs" py={6}>
            <IconCalendarEvent size={14} color="var(--mantine-color-dark-3)" />
            <Text size="xs" c="dimmed">Tag to an event</Text>
            <IconChevronDown size={12} color="var(--mantine-color-dark-3)" />
          </Group>
        </UnstyledButton>
        <EventPickerModal opened={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  return (
    <>
      <Box
        px="xs"
        py={6}
        style={{
          borderRadius: 'var(--mantine-radius-sm)',
          border: '1px solid var(--mantine-color-violet-9)',
          background: 'var(--mantine-color-dark-8)',
        }}
      >
        <Group justify="space-between" wrap="nowrap">
          <UnstyledButton onClick={() => setOpen(true)} style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" wrap="nowrap">
              <IconCalendarEvent size={14} color="var(--mantine-color-violet-4)" />
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text size="xs" fw={600} c="violet.4" truncate>{activeEvent.name}</Text>
                {(activeEvent.location || activeEvent.startsAt) && (
                  <Text size="10px" c="dimmed" truncate>
                    {[activeEvent.location, formatEventDates(activeEvent.startsAt, activeEvent.endsAt)]
                      .filter(Boolean).join(' · ')}
                  </Text>
                )}
              </Stack>
            </Group>
          </UnstyledButton>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="xs"
            onClick={() => { localStorage.removeItem('selectedEventId'); setActiveEventId(null); }}
          >
            <IconX size={11} />
          </ActionIcon>
        </Group>
      </Box>
      <EventPickerModal opened={open} onClose={() => setOpen(false)} />
    </>
  );
}
