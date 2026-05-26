import { useState, useRef, useEffect } from 'react';
import {
  Modal, Stack, Group, Text, TextInput, NumberInput, Button,
  Image, Box, ScrollArea, Divider, ActionIcon, Alert,
  Loader, Badge, SimpleGrid,
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
    <Modal
      opened={opened}
      onClose={onClose}
      title="Add Stock"
      size="xl"
      closeOnClickOutside={!saving}
      styles={{
        content: { height: 'calc(100dvh - 5rem)', display: 'flex', flexDirection: 'column' },
        body:    { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' },
      }}
    >
      <Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
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

        {/* Card grid */}
        {lines.length > 0 && (
          <ScrollArea style={{ flex: 1, minHeight: 0 }}>
            <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="sm">
              {lines.map((line) => (
                <Stack key={line._id} gap={4}>
                  <Box style={{ position: 'relative' }}>
                    {line.cardImageUrl ? (
                      <Image
                        src={line.cardImageUrl}
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
                          {line.cardName ?? '—'}
                        </Text>
                      </Box>
                    )}
                    <ActionIcon
                      style={{ position: 'absolute', top: 4, right: 4 }}
                      size="xs" variant="filled" color="red" radius="sm"
                      onClick={() => removeLine(line._id)}
                      disabled={saving}
                    >
                      <IconX size={10} />
                    </ActionIcon>
                  </Box>
                  <Stack gap={1}>
                    <Text size="xs" fw={500} lineClamp={2}>{line.cardName}</Text>
                    <Text size="xs" c="dimmed" truncate>
                      {[line.cardSetName, line.cardNumber, line.cardLang].filter(Boolean).join(' · ')}
                    </Text>
                  </Stack>
                  <Group gap={4} wrap="nowrap">
                    <CurrencyInput
                      size="xs"
                      leftSection={<Text size="xs" c="dimmed">RM</Text>}
                      leftSectionWidth={28}
                      value={line.unitPriceMyr}
                      onChange={(v) => updateLine(line._id, 'unitPriceMyr', v)}
                      disabled={saving}
                      style={{ flex: 1, minWidth: 0 }}
                      styles={{ input: { textAlign: 'right' } }}
                    />
                    <NumberInput
                      size="xs"
                      min={1}
                      value={line.qty}
                      onChange={(v) => updateLine(line._id, 'qty', v || 1)}
                      disabled={saving}
                      allowDecimal={false}
                      hideControls
                      w={44}
                      styles={{ input: { textAlign: 'center' } }}
                    />
                  </Group>
                </Stack>
              ))}
            </SimpleGrid>
          </ScrollArea>
        )}

        {lines.length === 0 && (
          <Text size="sm" c="dimmed" ta="center" py="md" style={{ flex: 1 }}>Search and add cards above.</Text>
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
