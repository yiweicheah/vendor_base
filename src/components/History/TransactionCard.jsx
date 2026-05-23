import { useState } from 'react';
import {
  Paper, Group, Stack, Text, Badge, ActionIcon,
  Divider, Box, Image, Collapse, Textarea, Button, TextInput, NumberInput, SimpleGrid,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import {
  IconChevronDown, IconChevronUp,
  IconTrash, IconPencil, IconCheck, IconX, IconPlus,
} from '@tabler/icons-react';
import {
  deleteTransaction, updateTransactionNotes,
  updateTransactionLine, deleteTransactionLine, saveTransactionLine,
  updateFundEntry, deleteFundEntry,
} from '../../lib/db';
import { getRates } from '../../lib/exchangeRates';
import useAuthStore from '../../store/authStore';
import useOrgStore from '../../store/orgStore';
import SearchModal from '../Search/SearchModal';
import CardDetailModal from '../Cards/CardDetailModal';

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

function rm(n)       { return `RM ${Math.abs(n).toFixed(2)}`; }
function sign(n)     { return n > 0.005 ? '+' : n < -0.005 ? '−' : ''; }
function netColor(n) { return n > 0.005 ? 'green.4' : n < -0.005 ? 'red.4' : 'dimmed'; }

function txMetrics(lines) {
  const sales     = lines.filter((l) => l.side === 'in'  && l.type === 'cash')
                         .reduce((s, l) => s + (l.unitPriceMyr || 0) * l.qty, 0);
  const purchases = lines.filter((l) => l.side === 'out' && l.type === 'cash')
                         .reduce((s, l) => s + (l.unitPriceMyr || 0) * l.qty, 0);
  const cardOut          = lines.filter((l) => l.side === 'out' && l.type === 'card');
  const cardSoldTotal    = cardOut.reduce((s, l) => s + l.qty, 0);
  const cardSoldWithCost = cardOut.reduce((s, l) => {
    const effectiveCost = l.cardExternalId == null ? (l.avgCostMyr ?? 0) : l.avgCostMyr;
    return effectiveCost != null ? s + l.qty : s;
  }, 0);
  const grossProfit = cardOut.reduce((s, l) => {
    const effectiveCost = l.cardExternalId == null ? (l.avgCostMyr ?? 0) : l.avgCostMyr;
    return effectiveCost != null ? s + ((l.unitPriceMyr || 0) - effectiveCost) * l.qty : s;
  }, 0);
  return {
    sales,
    purchases,
    grossProfit:    +grossProfit.toFixed(2),
    cardSoldTotal,
    profitComplete: cardSoldTotal === 0 || cardSoldWithCost === cardSoldTotal,
    net:            sales - purchases,
  };
}

// ─── Line row ─────────────────────────────────────────────────────────────────

function LineRow({ line, editing, lineEdits, setLineEdits, qtyEdits, setQtyEdits, onDelete, deletingLine }) {
  const isCard   = line.type === 'card';
  const isSealed = line.type === 'sealed';
  const label    = isCard ? line.cardName : isSealed ? line.sealedName : 'Cash';
  const sub      = isCard
    ? [line.cardSetName, line.cardNumber, line.cardLang].filter(Boolean).join(' · ')
    : null;

  const rawPrice  = lineEdits?.[line.id] ?? String(line.unitPriceMyr ?? 0);
  const unitPrice = parseFloat(rawPrice) || 0;
  const qty       = qtyEdits?.[line.id] ?? line.qty;
  const total     = unitPrice * qty;

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
          {line.side === 'out' && line.type === 'card' && line.avgCostMyr != null && !editing && (() => {
            const pct = line.avgCostMyr > 0
              ? ((unitPrice - line.avgCostMyr) / line.avgCostMyr) * 100
              : null;
            return (
              <Text size="xs" c={pct == null ? 'dimmed' : pct >= 0 ? 'teal.4' : 'red.4'}>
                Avg RM {line.avgCostMyr.toFixed(2)}{pct != null ? ` · ${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%` : ''}
              </Text>
            );
          })()}
        </Stack>
      </Group>

      {editing ? (
        <Group gap={4} align="center" style={{ flexShrink: 0 }}>
          <TextInput
            size="xs"
            value={rawPrice}
            onChange={(e) => {
              const val = e.currentTarget.value;
              setLineEdits((prev) => ({ ...prev, [line.id]: val }));
            }}
            leftSection={<Text size="xs" c="dimmed">RM</Text>}
            leftSectionWidth={32}
            w={90}
            styles={{ input: { textAlign: 'right' } }}
          />
          <Text size="xs" c="dimmed">×</Text>
          <NumberInput
            size="xs"
            value={qty}
            onChange={(val) => {
              if (typeof val === 'number' && val >= 1) {
                setQtyEdits((prev) => ({ ...prev, [line.id]: val }));
              }
            }}
            min={1}
            allowDecimal={false}
            hideControls
            w={44}
            styles={{ input: { textAlign: 'center' } }}
          />
          <ActionIcon
            size="xs" variant="subtle" color="red"
            loading={deletingLine === line.id}
            onClick={() => onDelete(line.id)}
          >
            <IconTrash size={11} />
          </ActionIcon>
        </Group>
      ) : (
        <Stack gap={1} align="flex-end" style={{ flexShrink: 0 }}>
          <Text size="sm" fw={500}>RM {total.toFixed(2)}</Text>
          <Text size="xs" c="dimmed">×{line.qty}</Text>
        </Stack>
      )}
    </Group>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TransactionCard({ tx, view = 'list' }) {
  const user = useAuthStore((s) => s.user);
  const role = useOrgStore((s) => s.role);
  const funds = useOrgStore((s) => s.funds);
  const {
    removeTransaction,
    updateTransactionNotes:  patchNotes,
    updateTransactionLine:   patchLine,
    removeTransactionLine,
    addTransactionLine,
    updateFundEntry:         updateFundEntryInStore,
    removeFundEntry:         removeFundEntryFromStore,
  } = useOrgStore();

  const isImport   = tx.notes?.startsWith('Stock import');
  const linkedFund = isImport
    ? funds.find((f) => f.note?.includes(`[tx:${tx.id}]`))
    : null;

  async function syncFundEntry(newTotalCost) {
    if (!linkedFund) return;
    await updateFundEntry({ id: linkedFund.id, amountMyr: newTotalCost });
    updateFundEntryInStore(linkedFund.id, newTotalCost);
  }

  const [expanded,     setExpanded]     = useState(false);
  const [editing,      setEditing]      = useState(false);
  const [notes,        setNotes]        = useState(tx.notes ?? '');
  const [lineEdits,    setLineEdits]    = useState({});
  const [qtyEdits,     setQtyEdits]     = useState({});
  const [savingN,      setSavingN]      = useState(false);
  const [deletingD,    setDeletingD]    = useState(false);
  const [deletingLine, setDeletingLine] = useState(null);
  const [addCardOpen,  setAddCardOpen]  = useState(false);
  const [addCardSide,  setAddCardSide]  = useState('in');
  const [detailCard,   setDetailCard]   = useState(null); // { id, imageUrl }

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
  const m            = txMetrics(lines);

  // ─── Delete transaction ────────────────────────────────────────────────────

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
          if (linkedFund) {
            await deleteFundEntry(linkedFund.id);
            removeFundEntryFromStore(linkedFund.id);
          }
          notifications.show({ message: 'Transaction deleted.', color: 'red', autoClose: 2000 });
        } catch (err) {
          notifications.show({ title: 'Delete failed', message: err.message, color: 'red' });
        } finally {
          setDeletingD(false);
        }
      },
    });
  }

  // ─── Delete line ───────────────────────────────────────────────────────────

  function handleDeleteLine(lineId) {
    modals.openConfirmModal({
      title:       'Remove line',
      children:    <Text size="sm">Remove this item from the transaction?</Text>,
      labels:      { confirm: 'Remove', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm:   async () => {
        setDeletingLine(lineId);
        try {
          await deleteTransactionLine(lineId);
          removeTransactionLine(tx.id, lineId);
          if (isImport) {
            const deletedLine = lines.find((l) => l.id === lineId);
            if (deletedLine?.side === 'in' && deletedLine?.type === 'card') {
              const newTotal = lines
                .filter((l) => l.side === 'in' && l.type === 'card' && l.id !== lineId)
                .reduce((sum, l) => sum + (l.unitPriceMyr || 0) * l.qty, 0);
              await syncFundEntry(newTotal);
            }
          }
          notifications.show({ message: 'Line removed.', color: 'orange', autoClose: 2000 });
        } catch (err) {
          notifications.show({ title: 'Failed', message: err.message, color: 'red' });
        } finally {
          setDeletingLine(null);
        }
      },
    });
  }

  // ─── Save (notes + price edits) ────────────────────────────────────────────

  async function handleSave() {
    setSavingN(true);
    try {
      const ops = [updateTransactionNotes({ txId: tx.id, notes: notes || null })];

      const editedLineIds = new Set([...Object.keys(lineEdits), ...Object.keys(qtyEdits)]);
      for (const lineId of editedLineIds) {
        const patch = {};
        if (lineId in lineEdits) {
          const parsed = parseFloat(lineEdits[lineId]);
          if (!isNaN(parsed)) patch.unitPriceMyr = parsed;
        }
        if (lineId in qtyEdits) {
          const q = qtyEdits[lineId];
          if (q >= 1) patch.qty = q;
        }
        if (Object.keys(patch).length > 0) {
          ops.push(
            updateTransactionLine({ lineId, ...patch })
              .then(() => patchLine(tx.id, lineId, patch))
          );
        }
      }

      await Promise.all(ops);
      if (isImport) {
        const newTotal = lines
          .filter((l) => l.side === 'in' && l.type === 'card')
          .reduce((sum, l) => {
            const price = l.id in lineEdits ? (parseFloat(lineEdits[l.id]) || 0) : (l.unitPriceMyr || 0);
            const qty   = l.id in qtyEdits  ? (qtyEdits[l.id] >= 1 ? qtyEdits[l.id] : l.qty) : l.qty;
            return sum + price * qty;
          }, 0);
        await syncFundEntry(newTotal);
      }
      patchNotes(tx.id, notes || null);
      setLineEdits({});
      setQtyEdits({});
      setEditing(false);
      notifications.show({ message: 'Transaction updated.', color: 'green', autoClose: 2000 });
    } catch (err) {
      notifications.show({ title: 'Save failed', message: err.message, color: 'red' });
    } finally {
      setSavingN(false);
    }
  }

  function handleCancelEdit() {
    setNotes(tx.notes ?? '');
    setLineEdits({});
    setQtyEdits({});
    setEditing(false);
  }

  // ─── Add card line ─────────────────────────────────────────────────────────

  async function handleCardSelect(cardData) {
    setAddCardOpen(false);
    const { USD_TO_MYR, EUR_TO_MYR } = getRates();
    try {
      const newId = await saveTransactionLine({
        transactionId:        tx.id,
        side:                 addCardSide,
        type:                 'card',
        qty:                  1,
        unitPriceMyr:         cardData.marketPriceMyr ?? 0,
        cardExternalId:       cardData.cardExternalId,
        cardName:             cardData.cardName,
        cardNumber:           cardData.cardNumber,
        cardSetName:          cardData.cardSetName,
        cardLang:             null,
        cardImageUrl:         cardData.cardImageUrl,
        marketPriceMyr:       cardData.marketPriceMyr,
        priceSource:          cardData.priceSource,
        usdToMyrRate:         USD_TO_MYR,
        eurToMyrRate:         EUR_TO_MYR,
        sealedProductId:      null,
        sealedName:           null,
        sealedReferencePrice: null,
      });
      addTransactionLine(tx.id, {
        id:             newId,
        side:           addCardSide,
        type:           'card',
        qty:            1,
        unitPriceMyr:   cardData.marketPriceMyr ?? 0,
        cardExternalId: cardData.cardExternalId,
        cardName:       cardData.cardName,
        cardNumber:     cardData.cardNumber,
        cardSetName:    cardData.cardSetName,
        cardLang:       null,
        cardImageUrl:   cardData.cardImageUrl,
        marketPriceMyr: cardData.marketPriceMyr,
        priceSource:    cardData.priceSource,
      });
      if (isImport && addCardSide === 'in') {
        const currentCost = lines
          .filter((l) => l.side === 'in' && l.type === 'card')
          .reduce((sum, l) => sum + (l.unitPriceMyr || 0) * l.qty, 0);
        await syncFundEntry(currentCost + (cardData.marketPriceMyr ?? 0));
      }
      notifications.show({ message: 'Card added.', color: 'teal', autoClose: 2000 });
    } catch (err) {
      notifications.show({ title: 'Failed to add card', message: err.message, color: 'red' });
    }
  }

  const isGrid = view === 'grid';

  // In/out sections used by both list and grid bodies
  function renderInOutLines() {
    return (
      <>
        {(inLines.length > 0 || editing) && (
          <Stack gap="xs" mb={outLines.length > 0 || editing ? 'sm' : 0}>
            <Group gap="xs">
              <Text size="xs" fw={700} tt="uppercase" c="violet.4" style={{ letterSpacing: '0.08em' }}>In</Text>
              <Text size="xs" c="dimmed">RM {lineTotal(inLines).toFixed(2)}</Text>
            </Group>
            <Stack gap="xs">
              {inLines.map((l) => (
                <LineRow
                  key={l.id}
                  line={l}
                  editing={editing}
                  lineEdits={lineEdits}
                  setLineEdits={setLineEdits}
                  qtyEdits={qtyEdits}
                  setQtyEdits={setQtyEdits}
                  onDelete={handleDeleteLine}
                  deletingLine={deletingLine}
                />
              ))}
            </Stack>
            {editing && (
              <Button
                size="xs" variant="subtle" color="violet"
                leftSection={<IconPlus size={12} />}
                onClick={() => { setAddCardSide('in'); setAddCardOpen(true); }}
              >
                Add card
              </Button>
            )}
          </Stack>
        )}

        {(outLines.length > 0 || editing) && (
          <Stack gap="xs">
            <Group gap="xs">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.08em' }}>Out</Text>
              <Text size="xs" c="dimmed">RM {lineTotal(outLines).toFixed(2)}</Text>
            </Group>
            <Stack gap="xs">
              {outLines.map((l) => (
                <LineRow
                  key={l.id}
                  line={l}
                  editing={editing}
                  lineEdits={lineEdits}
                  setLineEdits={setLineEdits}
                  qtyEdits={qtyEdits}
                  setQtyEdits={setQtyEdits}
                  onDelete={handleDeleteLine}
                  deletingLine={deletingLine}
                />
              ))}
            </Stack>
            {editing && (
              <Button
                size="xs" variant="subtle" color="gray"
                leftSection={<IconPlus size={12} />}
                onClick={() => { setAddCardSide('out'); setAddCardOpen(true); }}
              >
                Add card
              </Button>
            )}
          </Stack>
        )}
      </>
    );
  }

  function renderNotes() {
    if (!editing) {
      return (tx.notes || notes) ? (
        <>
          <Divider my="sm" variant="dashed" />
          <Text size="xs" c="dimmed" fs="italic">{notes || tx.notes}</Text>
        </>
      ) : null;
    }
    return (
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
            <Button size="xs" loading={savingN} leftSection={<IconCheck size={12} />} onClick={handleSave}>
              Save
            </Button>
            <Button size="xs" variant="subtle" color="gray" leftSection={<IconX size={12} />} onClick={handleCancelEdit}>
              Cancel
            </Button>
          </Group>
        </Stack>
      </>
    );
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
          <Group gap="xs" wrap="wrap" mt={2}>
            <Text size="xs" c="dimmed">Sales {rm(m.sales)}</Text>
            <Text size="xs" c="dimmed">·</Text>
            <Text size="xs" c="dimmed">Purchases −{rm(m.purchases)}</Text>
            {m.cardSoldTotal > 0 && (
              <>
                <Text size="xs" c="dimmed">·</Text>
                <Text size="xs" c={netColor(m.grossProfit)}>
                  Profit {sign(m.grossProfit)}{rm(m.grossProfit)}{!m.profitComplete ? ' ~' : ''}
                </Text>
              </>
            )}
            <Text size="xs" c="dimmed">·</Text>
            <Text size="xs" fw={500} c={netColor(m.net)}>Net {sign(m.net)}{rm(m.net)}</Text>
          </Group>
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

      {/* Grid mode: collapsible card image grid with inline editing */}
      {isGrid && (
        <Collapse expanded={expanded}>
          <Divider my="sm" />
          {(() => {
            const sections = [
              { label: 'In',  side: 'in',  color: 'violet.4', cardLines: inLines.filter((l)  => l.type === 'card') },
              { label: 'Out', side: 'out', color: 'dimmed',   cardLines: outLines.filter((l) => l.type === 'card') },
            ].filter((s) => editing || s.cardLines.length > 0);

            if (sections.length === 0) {
              return <Text size="xs" c="dimmed">No cards</Text>;
            }

            return (
              <Stack gap="sm">
                {sections.map(({ label, side, color, cardLines }) => (
                  <Stack key={label} gap={6}>
                    <Group gap="xs">
                      <Text size="xs" fw={700} tt="uppercase" c={color} style={{ letterSpacing: '0.08em' }}>
                        {label}
                      </Text>
                      <Text size="xs" c="dimmed">
                        RM {lineTotal(side === 'in' ? inLines : outLines).toFixed(2)}
                      </Text>
                    </Group>

                    {cardLines.length > 0 && (
                      <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing={4}>
                        {cardLines.map((l) => (
                          <Stack key={l.id} gap={4}>
                            <Box
                              style={{ position: 'relative', cursor: l.cardExternalId && !editing ? 'pointer' : 'default' }}
                              onClick={l.cardExternalId && !editing ? () => setDetailCard({ id: String(l.cardExternalId), imageUrl: l.cardImageUrl ?? null }) : undefined}
                            >
                              {l.cardImageUrl ? (
                                <Image
                                  src={l.cardImageUrl}
                                  fit="contain"
                                  style={{ aspectRatio: '245/337', width: '100%', borderRadius: '4.4%', overflow: 'hidden' }}
                                />
                              ) : (
                                <Box
                                  bg="dark.6"
                                  style={{
                                    aspectRatio: '245/337',
                                    borderRadius: '4.4%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                >
                                  <Text size="xs" c="dimmed" ta="center" px={2} lineClamp={2}>
                                    {l.cardName ?? '—'}
                                  </Text>
                                </Box>
                              )}
                              {editing && (
                                <ActionIcon
                                  style={{ position: 'absolute', top: 2, right: 2 }}
                                  size="xs" variant="filled" color="red" radius="sm"
                                  loading={deletingLine === l.id}
                                  onClick={() => handleDeleteLine(l.id)}
                                >
                                  <IconTrash size={10} />
                                </ActionIcon>
                              )}
                            </Box>
                            <Stack gap={1}>
                              <Text size="xs" fw={500} lineClamp={2}>{l.cardName ?? '—'}</Text>
                              {l.cardSetName && (
                                <Text size="xs" c="dimmed" truncate>{l.cardSetName}</Text>
                              )}
                              {editing ? (
                                <Group gap={4} wrap="nowrap">
                                  <TextInput
                                    size="xs"
                                    value={lineEdits[l.id] ?? String(l.unitPriceMyr ?? 0)}
                                    onChange={(e) => {
                                      const val = e.currentTarget.value;
                                      setLineEdits((prev) => ({ ...prev, [l.id]: val }));
                                    }}
                                    leftSection={<Text size="xs" c="dimmed">RM</Text>}
                                    leftSectionWidth={28}
                                    styles={{ input: { textAlign: 'right' } }}
                                  />
                                  <NumberInput
                                    size="xs"
                                    value={qtyEdits[l.id] ?? l.qty}
                                    onChange={(val) => {
                                      if (typeof val === 'number' && val >= 1) {
                                        setQtyEdits((prev) => ({ ...prev, [l.id]: val }));
                                      }
                                    }}
                                    min={1}
                                    allowDecimal={false}
                                    hideControls
                                    w={44}
                                    styles={{ input: { textAlign: 'center' } }}
                                  />
                                </Group>
                              ) : (
                                <Text size="xs">RM {(l.unitPriceMyr ?? 0).toFixed(2)}</Text>
                              )}
                              {l.marketPriceMyr != null && (
                                <Text size="xs" c="dimmed">Mkt RM {l.marketPriceMyr.toFixed(2)}</Text>
                              )}
                              {l.side === 'out' && l.avgCostMyr != null && (() => {
                                const pct = l.avgCostMyr > 0
                                  ? ((l.unitPriceMyr ?? 0) - l.avgCostMyr) / l.avgCostMyr * 100
                                  : null;
                                return (
                                  <Text size="xs" c={pct == null ? 'dimmed' : pct >= 0 ? 'teal.4' : 'red.4'}>
                                    Avg RM {l.avgCostMyr.toFixed(2)}{pct != null ? ` · ${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%` : ''}
                                  </Text>
                                );
                              })()}
                            </Stack>
                          </Stack>
                        ))}
                      </SimpleGrid>
                    )}

                    {editing && (
                      <Button
                        size="xs" variant="subtle"
                        color={side === 'in' ? 'violet' : 'gray'}
                        leftSection={<IconPlus size={12} />}
                        onClick={() => { setAddCardSide(side); setAddCardOpen(true); }}
                      >
                        Add card
                      </Button>
                    )}
                  </Stack>
                ))}
                {renderNotes()}
              </Stack>
            );
          })()}
        </Collapse>
      )}

      {/* List mode: collapsible detail */}
      {!isGrid && (
        <Collapse expanded={expanded}>
          <Divider my="sm" />
          {renderInOutLines()}
          {renderNotes()}
        </Collapse>
      )}

      <SearchModal
        opened={addCardOpen}
        onClose={() => setAddCardOpen(false)}
        side={addCardSide}
        onCardSelect={handleCardSelect}
      />
      <CardDetailModal
        cardExternalId={detailCard?.id ?? null}
        fallbackImageUrl={detailCard?.imageUrl ?? null}
        onClose={() => setDetailCard(null)}
      />
    </Paper>
  );
}
