import { useState, useRef, useEffect } from 'react';
import {
  Modal, Stack, Group, Text, TextInput, NumberInput, Button,
  Image, Box, ScrollArea, Divider, ActionIcon, Alert,
  Loader, Badge,
} from '@mantine/core';
import CurrencyInput from '../shared/CurrencyInput';
import { notifications } from '@mantine/notifications';
import { IconSearch, IconX, IconPlus, IconAlertCircle } from '@tabler/icons-react';
import { searchCards, extractPrice, getTcgplayerImageUrl } from '../../lib/pokewallet';
import { saveTransaction, saveTransactionLine, loadTransactions, getOrCreateImportEvent } from '../../lib/db';
import { getRates } from '../../lib/exchangeRates';
import useOrgStore from '../../store/orgStore';
import useAuthStore from '../../store/authStore';

export default function AddStockModal({ opened, onClose }) {
  const org                = useOrgStore((s) => s.org);
  const events             = useOrgStore((s) => s.events);
  const addEvent           = useOrgStore((s) => s.addEvent);
  const setTransactions    = useOrgStore((s) => s.setTransactions);
  const refreshAggregates  = useOrgStore((s) => s.refreshAggregates);
  const refreshStock       = useOrgStore((s) => s.refreshStock);
  const funds              = useOrgStore((s) => s.funds);
  const metrics            = useOrgStore((s) => s.metrics);
  const user               = useAuthStore((s) => s.user);

  const [query,      setQuery]      = useState('');
  const [results,    setResults]    = useState([]);
  const [searching,  setSearching]  = useState(false);
  const [lines,      setLines]      = useState([]);
  const [saving,     setSaving]     = useState(false);
  const debounceRef  = useRef(null);
  const abortRef     = useRef(null);

  useEffect(() => {
    if (!opened) {
      setQuery('');
      setResults([]);
      setLines([]);
      setSaving(false);
    }
  }, [opened]);

  function handleQueryChange(val) {
    setQuery(val);
    clearTimeout(debounceRef.current);
    if (!val.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setSearching(true);
      try {
        const data = await searchCards({ query: val, signal: abortRef.current.signal });
        setResults(data.results ?? []);
      } catch (e) {
        if (e.name !== 'AbortError') setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  function addCard(card) {
    const imageUrl = getTcgplayerImageUrl(card.tcgplayer?.url) ?? null;
    const priceInfo = extractPrice(card);
    setLines((prev) => [
      ...prev,
      {
        _id:            crypto.randomUUID(),
        cardExternalId: String(card.id),
        cardName:       card.name,
        cardNumber:     card.collector_number ?? null,
        cardSetName:    card.set?.name ?? null,
        cardLang:       card.language ?? 'EN',
        cardImageUrl:   imageUrl,
        marketPriceMyr: priceInfo?.myr ?? null,
        priceSource:    priceInfo?.source ?? null,
        qty:            1,
        unitPriceMyr:   priceInfo?.myr ?? 0,
      },
    ]);
    setQuery('');
    setResults([]);
  }

  function removeLine(id) {
    setLines((prev) => prev.filter((l) => l._id !== id));
  }

  function updateLine(id, field, value) {
    setLines((prev) => prev.map((l) => l._id === id ? { ...l, [field]: value } : l));
  }

  const totalCost    = lines.reduce((sum, l) => sum + (l.unitPriceMyr || 0) * (l.qty || 0), 0);
  const totalFunds   = funds.reduce((sum, f) => sum + (f.amountMyr ?? 0), 0);
  const fundOnHand   = totalFunds + (metrics?.netCashFlow ?? 0);
  const insufficient = totalCost > 0 && totalCost > fundOnHand;

  async function handleSave() {
    if (!org?.id || !user?.dbId || lines.length === 0) return;
    setSaving(true);
    try {
      const { USD_TO_MYR, EUR_TO_MYR } = getRates();
      const importEvent = await getOrCreateImportEvent({ orgId: org.id, createdById: user.dbId, existingEvents: events });
      if (!events.find((e) => e.id === importEvent.id)) addEvent(importEvent);

      const date = new Date().toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });

      const txId = await saveTransaction({
        orgId:        org.id,
        createdById:  user.dbId,
        notes:        `Stock addition — ${date}`,
        eventId:      importEvent.id,
        paymentMethod: null,
      });

      await Promise.all(
        lines.map((line) =>
          saveTransactionLine({
            transactionId:  txId,
            side:           'in',
            type:           'card',
            qty:            line.qty,
            unitPriceMyr:   line.unitPriceMyr,
            cardExternalId: line.cardExternalId,
            cardName:       line.cardName,
            cardNumber:     line.cardNumber,
            cardSetName:    line.cardSetName,
            cardLang:       line.cardLang,
            cardImageUrl:   line.cardImageUrl,
            marketPriceMyr: line.marketPriceMyr,
            priceSource:    line.priceSource,
            usdToMyrRate:   USD_TO_MYR,
            eurToMyrRate:   EUR_TO_MYR,
            sealedProductId:      null,
            sealedName:           null,
            sealedReferencePrice: null,
          })
        )
      );

      if (totalCost > 0) {
        await saveTransactionLine({
          transactionId: txId,
          side:          'out',
          type:          'cash',
          qty:           1,
          unitPriceMyr:  totalCost,
          cardExternalId: null, cardName: null, cardNumber: null,
          cardSetName: null, cardLang: null, cardImageUrl: null,
          marketPriceMyr: null, priceSource: null,
          usdToMyrRate: USD_TO_MYR, eurToMyrRate: EUR_TO_MYR,
          sealedProductId: null, sealedName: null, sealedReferencePrice: null,
        });
      }

      const [refreshed] = await Promise.all([
        loadTransactions(org.id),
        refreshAggregates(org.id),
        refreshStock(org.id),
      ]);
      setTransactions(refreshed);

      notifications.show({
        message:   `${lines.length} card${lines.length !== 1 ? 's' : ''} added to stock.`,
        color:     'green',
        autoClose: 3000,
      });
      onClose();
    } catch (err) {
      notifications.show({ title: 'Failed to add stock', message: err.message, color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Add Stock" size="lg" closeOnClickOutside={!saving}>
      <Stack gap="sm">
        {/* Search */}
        <Box style={{ position: 'relative' }}>
          <TextInput
            placeholder="Search card name…"
            leftSection={searching ? <Loader size={14} /> : <IconSearch size={14} />}
            value={query}
            onChange={(e) => handleQueryChange(e.currentTarget.value)}
            disabled={saving}
          />
          {results.length > 0 && (
            <Box
              style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                background: 'var(--mantine-color-dark-7)',
                border: '1px solid var(--mantine-color-dark-4)',
                borderRadius: 4, marginTop: 2,
              }}
            >
              <ScrollArea mah={240}>
                {results.map((card) => {
                  const img = getTcgplayerImageUrl(card.tcgplayer?.url);
                  return (
                    <Group
                      key={card.id}
                      px="sm" py={6} gap="sm"
                      style={{ cursor: 'pointer' }}
                      onClick={() => addCard(card)}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--mantine-color-dark-6)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = ''}
                    >
                      {img ? (
                        <Image src={img} w={24} h={34} radius="xs" fit="contain" />
                      ) : (
                        <Box w={24} h={34} bg="dark.6" style={{ borderRadius: 3 }} />
                      )}
                      <Stack gap={0} style={{ flex: 1 }}>
                        <Text size="xs" fw={500} lineClamp={1}>{card.name}</Text>
                        <Text size="xs" c="dimmed">{card.set?.name} · {card.collector_number}</Text>
                      </Stack>
                      <IconPlus size={14} color="var(--mantine-color-dimmed)" />
                    </Group>
                  );
                })}
              </ScrollArea>
            </Box>
          )}
        </Box>

        {/* Card list */}
        {lines.length > 0 && (
          <ScrollArea mah={300}>
            <Stack gap="xs">
              {lines.map((line) => (
                <Group key={line._id} gap="sm" wrap="nowrap" align="center">
                  {line.cardImageUrl ? (
                    <Image src={line.cardImageUrl} w={28} h={39} radius="xs" fit="contain" style={{ flexShrink: 0 }} />
                  ) : (
                    <Box w={28} h={39} bg="dark.6" style={{ borderRadius: 3, flexShrink: 0 }} />
                  )}
                  <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
                    <Text size="xs" fw={500} truncate>{line.cardName}</Text>
                    <Text size="xs" c="dimmed" truncate>{[line.cardSetName, line.cardNumber, line.cardLang].filter(Boolean).join(' · ')}</Text>
                  </Stack>
                  <NumberInput
                    size="xs"
                    w={60}
                    min={1}
                    value={line.qty}
                    onChange={(v) => updateLine(line._id, 'qty', v || 1)}
                    disabled={saving}
                  />
                  <CurrencyInput
                    size="xs"
                    w={90}
                    leftSection={<Text size="xs" c="dimmed">RM</Text>}
                    value={line.unitPriceMyr}
                    onChange={(v) => updateLine(line._id, 'unitPriceMyr', v)}
                    disabled={saving}
                  />
                  <ActionIcon variant="subtle" color="red" size="sm" onClick={() => removeLine(line._id)} disabled={saving}>
                    <IconX size={14} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          </ScrollArea>
        )}

        {lines.length === 0 && (
          <Text size="sm" c="dimmed" ta="center" py="md">Search and add cards above.</Text>
        )}

        {lines.length > 0 && (
          <>
            <Divider />
            <Group justify="space-between">
              <Text size="sm" c="dimmed">Total</Text>
              <Text size="sm" fw={600}>RM {totalCost.toFixed(2)}</Text>
            </Group>

            {insufficient && (
              <Alert icon={<IconAlertCircle size={16} />} color="orange" variant="light">
                This purchase costs{' '}
                <Text component="span" fw={600} size="sm">MYR {totalCost.toFixed(2)}</Text>
                {' '}but current funds on hand are only{' '}
                <Text component="span" fw={600} size="sm">MYR {fundOnHand.toFixed(2)}</Text>.
                {' '}Add funds manually if needed.
              </Alert>
            )}

            <Button fullWidth onClick={handleSave} loading={saving} disabled={lines.length === 0}>
              Add {lines.length} card{lines.length !== 1 ? 's' : ''} to stock
            </Button>
          </>
        )}
      </Stack>
    </Modal>
  );
}
