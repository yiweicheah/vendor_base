import {
  Paper, Group, Stack, Text, ActionIcon,
  NumberInput, Badge, Divider, Image, Box, ThemeIcon,
} from '@mantine/core';
import {
  IconX, IconPlus, IconMinus, IconCurrencyDollar,
} from '@tabler/icons-react';
import { calcPct, pctColor } from '../../lib/pricing';
import { getStock } from '../../lib/inventory';
import useCartStore from '../../store/cartStore';
import useOrgStore from '../../store/orgStore';

function StockBadge({ stock }) {
  if (stock === null) return null;
  if (stock > 1)  return <Badge color="gray"  variant="light" size="xs">{stock} in stock</Badge>;
  if (stock === 1) return <Badge color="yellow" variant="light" size="xs">Last 1</Badge>;
  return <Badge color="red" variant="light" size="xs">Not in stock</Badge>;
}

export default function CartLine({ line, side }) {
  const { removeLine, updateLine } = useCartStore();
  const transactions = useOrgStore((s) => s.transactions);

  const pct   = calcPct(line.unitPrice, line.marketPrice);
  const color = pctColor(pct, side);

  // Stock is only relevant for card lines on the OUT side
  const stock = (side === 'out' && line.type === 'card')
    ? getStock(line.cardExternalId, transactions)
    : null;

  function increment() {
    updateLine(side, line.id, { qty: line.qty + 1 });
  }
  function decrement() {
    if (line.qty <= 1) return;
    updateLine(side, line.id, { qty: line.qty - 1 });
  }

  // ─── Auto-balance cash line ───────────────────────────────────────────────
  if (line.type === 'cash' && line.isAutoBalance) {
    return (
      <Paper withBorder p="sm" radius="md" style={{ opacity: 0.85 }}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" color="violet" size="md" radius="sm">
              <IconCurrencyDollar size={16} />
            </ThemeIcon>
            <Stack gap={0}>
              <Text size="sm" fw={500}>Cash</Text>
              <Text size="xs" c="dimmed">auto-balance</Text>
            </Stack>
          </Group>
          <Text size="sm" fw={600}>RM {(line.unitPrice ?? 0).toFixed(2)}</Text>
        </Group>
      </Paper>
    );
  }

  // ─── Cash line ────────────────────────────────────────────────────────────
  if (line.type === 'cash') {
    return (
      <Paper withBorder p="sm" radius="md">
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" color="gray" size="md" radius="sm">
              <IconCurrencyDollar size={16} />
            </ThemeIcon>
            <Text size="sm" fw={500}>Cash</Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <NumberInput
              value={line.unitPrice ?? ''}
              onChange={(val) => { if (typeof val === 'number') updateLine(side, line.id, { unitPrice: val }); }}
              onBlur={(e) => { const v = parseFloat(e.currentTarget.value); updateLine(side, line.id, { unitPrice: isNaN(v) ? 0 : v }); }}
              leftSection={<Text size="xs" c="dimmed">RM</Text>}
              decimalScale={2}
              fixedDecimalScale
              min={0}
              hideControls
              w={130}
              size="sm"
              styles={{ input: { textAlign: 'right' } }}
            />
            <ActionIcon
              variant="subtle"
              color="red"
              size="sm"
              onClick={() => removeLine(side, line.id)}
            >
              <IconX size={14} />
            </ActionIcon>
          </Group>
        </Group>
      </Paper>
    );
  }

  // ─── Card line ────────────────────────────────────────────────────────────
  return (
    <Paper withBorder p="sm" radius="md">
      <Stack gap="sm">

        {/* Row 1 — identity */}
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            {line.imageUrl ? (
              <Image
                src={line.imageUrl}
                w={40} h={56}
                radius="sm"
                fit="contain"
                style={{ flexShrink: 0 }}
              />
            ) : (
              <Box
                w={40} h={56}
                bg="dark.6"
                style={{ borderRadius: 4, flexShrink: 0 }}
              />
            )}
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                <Text size="sm" fw={500} truncate>{line.cardName}</Text>
                <StockBadge stock={stock} />
              </Group>
              <Text size="xs" c="dimmed" truncate>
                {[line.setName, line.cardNumber, line.lang]
                  .filter(Boolean).join(' · ')}
              </Text>
            </Stack>
          </Group>
          <ActionIcon
            variant="subtle"
            color="red"
            size="sm"
            style={{ flexShrink: 0 }}
            onClick={() => removeLine(side, line.id)}
          >
            <IconX size={14} />
          </ActionIcon>
        </Group>

        {/* Row 2 — qty and price */}
        <Group grow gap="md">
          <Stack gap={4}>
            <Text size="xs" c="dimmed" fw={500}>Qty</Text>
            <Group gap={0} wrap="nowrap">
              <ActionIcon
                variant="default"
                size="lg"
                radius="sm"
                style={{ borderRight: 'none', borderRadius: '4px 0 0 4px' }}
                onClick={decrement}
              >
                <IconMinus size={13} />
              </ActionIcon>
              <Box
                style={{
                  width: 40,
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid var(--mantine-color-dark-4)',
                }}
              >
                <Text size="sm">{line.qty}</Text>
              </Box>
              <ActionIcon
                variant="default"
                size="lg"
                radius="sm"
                style={{ borderLeft: 'none', borderRadius: '0 4px 4px 0' }}
                onClick={increment}
              >
                <IconPlus size={13} />
              </ActionIcon>
            </Group>
          </Stack>

          <Stack gap={4}>
            <Text size="xs" c="dimmed" fw={500}>Unit Price</Text>
            <NumberInput
              value={line.unitPrice ?? ''}
              onChange={(val) => { if (typeof val === 'number') updateLine(side, line.id, { unitPrice: val }); }}
              onBlur={(e) => { const v = parseFloat(e.currentTarget.value); updateLine(side, line.id, { unitPrice: isNaN(v) ? 0 : v }); }}
              leftSection={<Text size="xs" c="dimmed">RM</Text>}
              decimalScale={2}
              fixedDecimalScale
              min={0}
              hideControls
              size="md"
              styles={{ input: { textAlign: 'right' } }}
            />
          </Stack>
        </Group>

        {/* Row 3 — market hint */}
        <Divider variant="dashed" />
        <Group justify="space-between" align="center">
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              {line.marketPrice
                ? `Market RM ${line.marketPrice.toFixed(2)}${line.priceSource ? ` · ${line.priceSource}` : ''}`
                : 'No market data'}
            </Text>
            {side === 'out' && line.avgCost != null && (
              <Text size="xs" c="dimmed">Avg cost RM {line.avgCost.toFixed(2)}</Text>
            )}
          </Stack>
          {pct != null && (
            <Badge color={color} variant="light" size="sm">
              {pct}%
            </Badge>
          )}
        </Group>

      </Stack>
    </Paper>
  );
}
