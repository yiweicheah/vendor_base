import { useState } from 'react';
import {
  Stack, Paper, Group, Text, Button, Box,
  ThemeIcon, ScrollArea,
} from '@mantine/core';
import {
  IconArrowDown, IconArrowUp,
  IconSearch, IconCurrencyDollar,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import useCartStore from '../store/cartStore';
import useAuthStore from '../store/authStore';
import useOrgStore from '../store/orgStore';
import CartLine from '../components/Cart/CartLine';
import CartFooter from '../components/Cart/CartFooter';
import EventSelector from '../components/Cart/EventSelector';
import SearchModal from '../components/Search/SearchModal';
import StockPickerModal from '../components/Cart/StockPickerModal';
import { getRates } from '../lib/exchangeRates';
import { saveTransaction, saveTransactionLine, loadTransactions } from '../lib/db';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lineTotal(lines) {
  return lines.reduce((sum, l) => sum + (l.unitPrice || 0) * l.qty, 0);
}

// ─── Section component ────────────────────────────────────────────────────────

function CartSection({ side, lines, onAddCard, onAddCash }) {
  const isIn    = side === 'in';
  const label   = isIn ? 'COMING IN' : 'GOING OUT';
  const color   = isIn ? 'violet' : 'gray';
  const Icon    = isIn ? IconArrowDown : IconArrowUp;
  const total   = lineTotal(lines);
  const isEmpty = lines.length === 0;

  return (
    <Paper
      p="md"
      radius="md"
      style={{
        border:     `1px solid var(--mantine-color-${isIn ? 'violet-9' : 'dark-4'})`,
        background: 'var(--mantine-color-dark-8)',
      }}
    >
      <Stack gap="md">

        <Group justify="space-between" align="center">
          <Group gap="xs">
            <ThemeIcon color={color} variant="light" size="sm" radius="sm">
              <Icon size={13} />
            </ThemeIcon>
            <Text
              size="xs"
              fw={700}
              tt="uppercase"
              c={`${color}.4`}
              style={{ letterSpacing: '0.08em' }}
            >
              {label}
            </Text>
          </Group>
          <Text size="sm" fw={600}>RM {total.toFixed(2)}</Text>
        </Group>

        {isEmpty ? (
          <Box
            p="md"
            style={{
              border:       '1px dashed var(--mantine-color-dark-4)',
              borderRadius: 'var(--mantine-radius-md)',
              textAlign:    'center',
            }}
          >
            <Text size="xs" c="dimmed">Nothing here yet</Text>
          </Box>
        ) : (
          <Stack gap="sm">
            {lines.map((line) => (
              <CartLine key={line.id} line={line} side={side} />
            ))}
          </Stack>
        )}

        <Group gap="xs">
          <Button
            variant="light"
            color={color}
            size="xs"
            leftSection={<IconSearch size={13} />}
            onClick={() => onAddCard(side)}
          >
            Add card
          </Button>
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            leftSection={<IconCurrencyDollar size={13} />}
            onClick={() => onAddCash(side)}
          >
            Add cash
          </Button>
        </Group>

      </Stack>
    </Paper>
  );
}

// ─── Main Cart page ───────────────────────────────────────────────────────────

export default function Cart() {
  const { inLines, outLines, addLine, clearCart } = useCartStore();
  const { user }           = useAuthStore();
  const { org, activeEventId, setTransactions } = useOrgStore();
  const [saving,           setSaving]           = useState(false);
  const [searchOpen,       setSearchOpen]       = useState(false);
  const [searchSide,       setSearchSide]       = useState('in');
  const [stockPickerOpen,  setStockPickerOpen]  = useState(false);

  const inTotal  = lineTotal(inLines);
  const outTotal = lineTotal(outLines);
  const hasLines = inLines.length > 0 || outLines.length > 0;

  function handleAddCard(side) {
    if (side === 'out') {
      setStockPickerOpen(true);
    } else {
      setSearchSide(side);
      setSearchOpen(true);
    }
  }

  function openSearchForOut() {
    setSearchSide('out');
    setSearchOpen(true);
  }

  function handleAddCash(side) {
    addLine(side, { type: 'cash', qty: 1, unitPrice: 0 });
  }

  async function handleSave() {
    if (!user?.dbId || !org?.id) return;

    setSaving(true);
    try {
      const { USD_TO_MYR, EUR_TO_MYR } = getRates();

      // 1. Create the transaction header
      const txResult = await saveTransaction({
        orgId:       org.id,
        createdById: user.dbId,
        notes:       null,
        eventId:     activeEventId ?? null,
      });

      const txId = txResult;
      if (!txId) throw new Error('Transaction insert returned no ID');

      // 2. Insert each line
      const allLines = [
        ...inLines.map((l)  => ({ ...l, side: 'in' })),
        ...outLines.map((l) => ({ ...l, side: 'out' })),
      ];

      await Promise.all(
        allLines.map((line) =>
          saveTransactionLine({
            transactionId:       txId,
            side:                line.side,
            type:                line.type,
            qty:                 line.qty,
            unitPriceMyr:        line.unitPrice,
            cardExternalId:      line.cardExternalId   ?? null,
            cardName:            line.cardName         ?? null,
            cardNumber:          line.cardNumber       ?? null,
            cardSetName:         line.setName          ?? null,
            cardLang:            line.lang             ?? null,
            cardImageUrl:        line.imageUrl         ?? null,
            marketPriceMyr:      line.marketPrice      ?? null,
            priceSource:         line.priceSource      ?? null,
            usdToMyrRate:        USD_TO_MYR,
            eurToMyrRate:        EUR_TO_MYR,
            sealedProductId:     null,
            sealedName:          line.sealedName       ?? null,
            sealedReferencePrice: line.sealedReferencePrice ?? null,
          })
        )
      );

      notifications.show({
        message:   'Transaction saved.',
        color:     'green',
        autoClose: 2000,
      });
      clearCart();
      const refreshed = await loadTransactions(org.id);
      setTransactions(refreshed);

    } catch (err) {
      console.error('Save transaction error:', err);
      notifications.show({
        title:   'Save failed',
        message: err.message ?? 'Something went wrong.',
        color:   'red',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box
      style={{
        display:       'flex',
        flexDirection: 'column',
        height:        '100%',
        overflow:      'hidden',
      }}
    >
      <ScrollArea style={{ flex: 1 }} p="md">
        <Stack gap="md" pb="md">
          <EventSelector />
          <CartSection
            side="in"
            lines={inLines}
            onAddCard={handleAddCard}
            onAddCash={handleAddCash}
          />
          <CartSection
            side="out"
            lines={outLines}
            onAddCard={handleAddCard}
            onAddCash={handleAddCash}
          />
        </Stack>
      </ScrollArea>

      <CartFooter
        inTotal={inTotal}
        outTotal={outTotal}
        onSave={handleSave}
        saving={saving}
        hasLines={hasLines}
      />

      <SearchModal
        opened={searchOpen}
        onClose={() => setSearchOpen(false)}
        side={searchSide}
      />

      <StockPickerModal
        opened={stockPickerOpen}
        onClose={() => setStockPickerOpen(false)}
        onSearchFallback={openSearchForOut}
      />
    </Box>
  );
}
