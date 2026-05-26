import { useState, useEffect, useRef } from 'react';
import {
  Stack, Paper, Group, Text, Button, Box,
  ThemeIcon, ScrollArea, Select,
} from '@mantine/core';
import {
  IconArrowDown, IconArrowUp,
  IconSearch, IconCurrencyDollar, IconStack2, IconPackage,
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
import SealedPickerModal from '../components/Cart/SealedPickerModal';
import { getRates } from '../lib/exchangeRates';
import { saveTransaction, saveTransactionLine } from '../lib/db';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lineTotal(lines) {
  return lines.reduce((sum, l) => sum + (l.unitPrice || 0) * l.qty, 0);
}

// ─── Section component ────────────────────────────────────────────────────────

const PCT_OPTIONS = ['100', '95', '90', '85', '80', '75', '70', '65', '60'];

function CartSection({ side, lines, onAddCard, onAddCash, onAddBulk, onAddSealed, pct, onPctChange }) {
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
          <Group gap="xs" align="center">
            {isIn && (
              <Select
                data={PCT_OPTIONS.map(p => ({ value: p, label: `${p}%` }))}
                value={String(pct ?? 100)}
                onChange={(val) => onPctChange?.(Number(val))}
                size="xs"
                w={72}
                allowDeselect={false}
                styles={{ input: { textAlign: 'center' } }}
              />
            )}
            <Text size="sm" fw={600}>RM {total.toFixed(2)}</Text>
          </Group>
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
          {!isIn && (
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              leftSection={<IconStack2 size={13} />}
              onClick={onAddBulk}
            >
              Bulk
            </Button>
          )}
          <Button
            variant="light"
            color="teal"
            size="xs"
            leftSection={<IconPackage size={13} />}
            onClick={() => onAddSealed(side)}
          >
            Sealed
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
  const { inLines, outLines, addLine, removeLine, updateLine, clearCart } = useCartStore();
  const { user }           = useAuthStore();
  const { org, activeEventId, bumpHistoryRev, refreshAggregates, refreshStock } = useOrgStore();
  const paymentMethods = useOrgStore((s) => s.paymentMethods);
  const [saving,           setSaving]           = useState(false);
  const [searchOpen,       setSearchOpen]       = useState(false);
  const [searchSide,       setSearchSide]       = useState('in');
  const [stockPickerOpen,  setStockPickerOpen]  = useState(false);
  const [sealedPickerOpen, setSealedPickerOpen] = useState(false);
  const [sealedPickerSide, setSealedPickerSide] = useState('in');
  const [inPct,            setInPct]            = useState(100);
  const [paymentMethod,    setPaymentMethod]    = useState(null);

  useEffect(() => {
    if (paymentMethods.length > 0 && !paymentMethod) {
      const cash = paymentMethods.find((m) => m.name === 'Cash');
      setPaymentMethod(cash ? cash.name : paymentMethods[0].name);
    }
  }, [paymentMethods]);

  const inTotal    = lineTotal(inLines);
  const outTotal   = lineTotal(outLines);
  const hasLines   = inLines.length > 0 || outLines.length > 0;
  const hasCashIn  = inLines.some((l) => l.type === 'cash');

  useEffect(() => {
    const balanceIn  = inLines.find(l => l.isAutoBalance);
    const balanceOut = outLines.find(l => l.isAutoBalance);

    const manualIn  = lineTotal(inLines.filter(l => !l.isAutoBalance));
    const manualOut = lineTotal(outLines.filter(l => !l.isAutoBalance));
    const diff = manualIn - manualOut;

    if (Math.abs(diff) < 0.005) {
      if (balanceIn)  removeLine('in',  balanceIn.id);
      if (balanceOut) removeLine('out', balanceOut.id);
    } else if (diff > 0) {
      if (balanceIn) removeLine('in', balanceIn.id);
      if (balanceOut) {
        if (Math.abs(balanceOut.unitPrice - diff) > 0.001)
          updateLine('out', balanceOut.id, { unitPrice: diff });
      } else {
        addLine('out', { type: 'cash', qty: 1, unitPrice: diff, isAutoBalance: true });
      }
    } else {
      if (balanceOut) removeLine('out', balanceOut.id);
      if (balanceIn) {
        if (Math.abs(balanceIn.unitPrice - (-diff)) > 0.001)
          updateLine('in', balanceIn.id, { unitPrice: -diff });
      } else {
        addLine('in', { type: 'cash', qty: 1, unitPrice: -diff, isAutoBalance: true });
      }
    }
  }, [inLines, outLines, addLine, removeLine, updateLine]);

  const inPctRef = useRef(inPct);
  inPctRef.current = inPct;

  const knownInLineIdsRef = useRef(new Set(inLines.map(l => l.id)));

  useEffect(() => {
    const pct = inPctRef.current;
    const knownIds = knownInLineIdsRef.current;

    const newCardLines = inLines.filter(
      l => !knownIds.has(l.id) && l.type === 'card' && l.marketPrice != null
    );

    knownInLineIdsRef.current = new Set(inLines.map(l => l.id));

    if (pct !== 100) {
      newCardLines.forEach(line => {
        updateLine('in', line.id, { unitPrice: +(line.marketPrice * pct / 100).toFixed(2) });
      });
    }
  }, [inLines.length, updateLine]);

  function handleInPctChange(pct) {
    setInPct(pct);
    inLines.forEach(line => {
      if (line.type === 'card' && line.marketPrice != null) {
        updateLine('in', line.id, { unitPrice: +(line.marketPrice * pct / 100).toFixed(2) });
      }
    });
  }

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

  function handleAddSealed(side) {
    setSealedPickerSide(side);
    setSealedPickerOpen(true);
  }

  function handleAddBulk() {
    addLine('out', { type: 'card', cardName: 'Bulk cards', qty: 1, unitPrice: 0 });
  }

  async function handleSave() {
    if (!user?.dbId || !org?.id) return;

    setSaving(true);
    try {
      const { USD_TO_MYR, EUR_TO_MYR } = getRates();

      // 1. Create the transaction header
      const txResult = await saveTransaction({
        orgId:         org.id,
        createdById:   user.dbId,
        notes:         null,
        eventId:       activeEventId ?? null,
        paymentMethod: paymentMethod ?? null,
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
            avgCostMyr:          line.avgCost          ?? null,
            marketPriceMyr:      line.marketPrice      ?? null,
            priceSource:         line.priceSource      ?? null,
            usdToMyrRate:        USD_TO_MYR,
            eurToMyrRate:        EUR_TO_MYR,
            sealedProductId:      null,
            sealedName:           line.sealedName        ?? null,
            sealedReferencePrice: line.sealedReferencePrice ?? null,
            sealedCatalogId:      line.sealedCatalogId   ?? null,
          })
        )
      );

      notifications.show({
        message:   'Transaction saved.',
        color:     'green',
        autoClose: 2000,
      });
      clearCart();
      setPaymentMethod(null);
      bumpHistoryRev();
      await Promise.all([
        refreshAggregates(org.id),
        refreshStock(org.id),
      ]);

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
            onAddSealed={handleAddSealed}
            pct={inPct}
            onPctChange={handleInPctChange}
          />
          <CartSection
            side="out"
            lines={outLines}
            onAddCard={handleAddCard}
            onAddCash={handleAddCash}
            onAddBulk={handleAddBulk}
            onAddSealed={handleAddSealed}
          />
        </Stack>
      </ScrollArea>

      <CartFooter
        inTotal={inTotal}
        outTotal={outTotal}
        onSave={handleSave}
        saving={saving}
        hasLines={hasLines}
        hasCashIn={hasCashIn}
        paymentMethod={paymentMethod}
        onPaymentMethodChange={setPaymentMethod}
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

      <SealedPickerModal
        opened={sealedPickerOpen}
        onClose={() => setSealedPickerOpen(false)}
        side={sealedPickerSide}
      />
    </Box>
  );
}
