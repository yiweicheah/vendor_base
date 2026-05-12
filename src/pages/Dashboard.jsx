import { useMemo, useState } from 'react';
import {
  Box, ScrollArea, Stack, Paper, Group, Text, Divider,
  ThemeIcon, Center, Button, Modal, NumberInput, TextInput,
} from '@mantine/core';
import {
  IconChartBar, IconTrendingUp, IconTrendingDown, IconMinus, IconPlus,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import useOrgStore from '../store/orgStore';
import useAuthStore from '../store/authStore';
import { computeMetrics } from '../lib/analytics';
import { createFundEntry } from '../lib/db';

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

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const transactions  = useOrgStore((s) => s.transactions);
  const funds         = useOrgStore((s) => s.funds);
  const org           = useOrgStore((s) => s.org);
  const role          = useOrgStore((s) => s.role);
  const addFundEntry  = useOrgStore((s) => s.addFundEntry);
  const user          = useAuthStore((s) => s.user);

  const [modalOpen, setModalOpen] = useState(false);

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
                    <MetaRow label="Cash received" value={rm(m.cashIn)} />
                    <MetaRow label="Cash paid"     value={rm(m.cashOut)} />
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
              <Stack gap="sm">
                <SectionLabel>By Event</SectionLabel>
                <Stack gap="xs">
                  {m.eventBreakdown.map((ev) => (
                    <Paper key={ev.id} withBorder p="sm" radius="md">
                      <Stack gap="xs">
                        <Group justify="space-between" wrap="nowrap">
                          <Text size="sm" fw={500} truncate>{ev.name}</Text>
                          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{ev.txCount} tx</Text>
                        </Group>
                        <Group justify="space-between">
                          <Text size="xs" c="dimmed">Cash in / out</Text>
                          <Text size="xs" c="dimmed">{rm(ev.cashIn)} / {rm(ev.cashOut)}</Text>
                        </Group>
                        <Group justify="space-between">
                          <Text size="xs" fw={600}>Net</Text>
                          <Text size="xs" fw={600} c={netColor(ev.netCash)}>
                            {sign(ev.netCash)}{rm(ev.netCash)}
                          </Text>
                        </Group>
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              </Stack>
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
    </>
  );
}
