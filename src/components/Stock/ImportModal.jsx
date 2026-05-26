import { useRef, useState } from 'react';
import {
  Modal, Stack, Text, Button, Group, FileButton,
  Progress, ScrollArea, Image, Box, Badge, Alert,
  Divider, Anchor, SegmentedControl,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconUpload, IconAlertCircle, IconCheck, IconX } from '@tabler/icons-react';
import { searchCards, extractPrice, getTcgplayerImageUrl } from '../../lib/pokewallet';
import { tokenize, buildQuery, buildAlternateNumberQuery } from '../../lib/tokenizer';
import { saveTransaction, saveTransactionLine, getOrCreateImportEvent } from '../../lib/db';
import { getRates } from '../../lib/exchangeRates';
import { rm, fmtMoney } from '../../lib/format';
import useOrgStore from '../../store/orgStore';
import useAuthStore from '../../store/authStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normaliseNumber(num) {
  if (!num) return '';
  const [lid, st] = num.split('/');
  return st ? `${parseInt(lid, 10)}/${st}` : `${parseInt(lid, 10)}`;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row.');

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    // Split respecting quoted fields
    const cols = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { cols.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    cols.push(cur.trim());

    return Object.fromEntries(headers.map((h, i) => [h, (cols[i] ?? '').replace(/^"|"$/g, '')]));
  });
}

function findBestMatch(results, discriminator) {
  if (!results?.length) return null;
  const exact = results.find((r) => r.card_info?.card_number === discriminator);
  if (exact) return exact;
  const normDisc = normaliseNumber(discriminator);
  const normed = results.find(
    (r) => normaliseNumber(r.card_info?.card_number ?? '') === normDisc
  );
  return normed ?? results[0];
}

// ─── Review row ───────────────────────────────────────────────────────────────

function MatchedRow({ line }) {
  return (
    <Group gap="sm" wrap="nowrap">
      {line.imageUrl ? (
        <Image src={line.imageUrl} w={24} h={33} radius="sm" fit="contain" style={{ flexShrink: 0 }} />
      ) : (
        <Box w={24} h={33} bg="dark.6" style={{ borderRadius: 3, flexShrink: 0 }} />
      )}
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Text size="xs" fw={500} truncate>{line.cardName}</Text>
        <Text size="xs" c="dimmed" truncate>
          {[line.cardSetName, line.cardNumber].filter(Boolean).join(' · ')}
        </Text>
      </Stack>
      <Group gap="xs" style={{ flexShrink: 0 }}>
        <Badge color="violet" variant="light" size="xs">×{line.qty}</Badge>
        <Text size="xs" c="dimmed">{rm(line.unitPriceMyr)}</Text>
      </Group>
    </Group>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export default function ImportModal({ opened, onClose }) {
  const org                = useOrgStore((s) => s.org);
  const events             = useOrgStore((s) => s.events);
  const addEvent           = useOrgStore((s) => s.addEvent);
  const bumpHistoryRev     = useOrgStore((s) => s.bumpHistoryRev);
  const refreshAggregates  = useOrgStore((s) => s.refreshAggregates);
  const refreshStock       = useOrgStore((s) => s.refreshStock);
  const funds              = useOrgStore((s) => s.funds);
  const metrics            = useOrgStore((s) => s.metrics);
  const user            = useAuthStore((s) => s.user);

  const [step,       setStep]       = useState('upload');   // 'upload' | 'processing' | 'review'
  const [fileType,   setFileType]   = useState('json');     // 'json' | 'csv'
  const [parseError, setParseError] = useState(null);
  const [progress,   setProgress]   = useState({ current: 0, total: 0, label: '' });
  const [matched,    setMatched]    = useState([]);
  const [unmatched,  setUnmatched]  = useState([]);
  const [saving,     setSaving]     = useState(false);
  const cancelledRef = useRef(false);

  function handleClose() {
    if (step === 'processing') return; // block close mid-processing
    cancelledRef.current = true;
    setStep('upload');
    setFileType('json');
    setParseError(null);
    setProgress({ current: 0, total: 0, label: '' });
    setMatched([]);
    setUnmatched([]);
    setSaving(false);
    onClose();
  }

  // ─── Step 1: parse file ───────────────────────────────────────────────────

  async function handleFile(file) {
    if (!file) return;
    setParseError(null);
    try {
      const text = await file.text();
      let parsed;
      if (fileType === 'csv') {
        parsed = parseCSV(text);
        if (parsed.length === 0) {
          setParseError('CSV has no data rows.');
          return;
        }
      } else {
        parsed = JSON.parse(text);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          setParseError('File must be a non-empty JSON array.');
          return;
        }
      }
      processItems(parsed);
    } catch (err) {
      setParseError(err.message || `Could not parse the file. Make sure it is valid ${fileType.toUpperCase()}.`);
    }
  }

  // ─── Step 2: resolve each item against PokéWallet ────────────────────────

  async function processItems(items) {
    cancelledRef.current = false;
    setStep('processing');
    setMatched([]);
    setUnmatched([]);

    const matchedAcc  = [];
    const unmatchedAcc = [];

    for (let i = 0; i < items.length; i++) {
      if (cancelledRef.current) break;

      const item  = items[i];
      const name  = item.product_name ?? '';
      const disc  = item.discriminator ?? '';
      const label = disc ? `${name} ${disc}` : name;

      setProgress({ current: i + 1, total: items.length, label });

      try {
        const parsed = tokenize(`${name} ${disc}`);
        const query  = buildQuery(parsed);
        const altQ   = parsed.nameTokens.length === 0
          ? buildAlternateNumberQuery({ localId: parsed.localId, setTotalRaw: parsed.setTotalRaw })
          : null;

        let results;
        if (altQ) {
          const [primary, alternate] = await Promise.all([
            searchCards({ query,      page: 1 }),
            searchCards({ query: altQ, page: 1 }),
          ]);
          const seen = new Set();
          results = [...(primary.results ?? []), ...(alternate.results ?? [])].filter((c) => {
            if (seen.has(c.id)) return false;
            seen.add(c.id);
            return true;
          });
        } else {
          const data = await searchCards({ query, page: 1 });
          results = data.results ?? [];
        }

        const card  = findBestMatch(results, disc);

        if (!card) {
          unmatchedAcc.push(item);
        } else {
          const priceInfo = extractPrice(card);
          const imageUrl  = card.tcgplayer?.url
            ? getTcgplayerImageUrl(card.tcgplayer.url)
            : null;
          const qty         = Math.max(1, parseInt(item.quantity, 10) || 1);
          const unitPrice   = parseFloat(item.paid_per_unit) || 0;
          const marketPrice = priceInfo?.myr ?? parseFloat(item.value_per_unit) ?? null;

          matchedAcc.push({
            // display fields
            cardName:    card.card_info?.name    ?? name,
            cardNumber:  card.card_info?.card_number ?? disc,
            cardSetName: card.card_info?.set_name ?? item.set_name ?? '',
            imageUrl,
            qty,
            unitPriceMyr: unitPrice,
            // transaction line fields
            type:           'card',
            side:           'in',
            cardExternalId: String(card.id),
            cardLang:       null,
            marketPriceMyr: marketPrice,
            priceSource:    priceInfo?.source ?? null,
          });
        }
      } catch (err) {
        if (err.code === 'RATE_LIMIT') {
          // Back off and retry this item
          await delay(5000);
          i--;
          continue;
        }
        unmatchedAcc.push(item);
      }

      await delay(150);
    }

    setMatched(matchedAcc);
    setUnmatched(unmatchedAcc);
    setStep('review');
  }

  function handleCancel() {
    cancelledRef.current = true;
    setStep('upload');
  }

  // ─── Step 3: confirm import ───────────────────────────────────────────────

  async function handleConfirm() {
    if (!org?.id || !user?.dbId || matched.length === 0) return;
    setSaving(true);
    try {
      const { USD_TO_MYR, EUR_TO_MYR } = getRates();
      const date = new Date().toLocaleDateString('en-MY', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
      const importEvent = await getOrCreateImportEvent({ orgId: org.id, createdById: user.dbId, existingEvents: events });
      if (!events.find((e) => e.id === importEvent.id)) addEvent(importEvent);

      const txId = await saveTransaction({
        orgId:       org.id,
        createdById: user.dbId,
        notes:       `Stock import — ${date}`,
        eventId:     importEvent.id,
      });

      await Promise.all(
        matched.map((line) =>
          saveTransactionLine({
            transactionId:  txId,
            side:           line.side,
            type:           line.type,
            qty:            line.qty,
            unitPriceMyr:   line.unitPriceMyr,
            cardExternalId: line.cardExternalId,
            cardName:       line.cardName,
            cardNumber:     line.cardNumber,
            cardSetName:    line.cardSetName,
            cardLang:       line.cardLang,
            cardImageUrl:   line.imageUrl,
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

      const totalCost = matched.reduce((sum, l) => sum + (l.unitPriceMyr || 0) * l.qty, 0);
      if (totalCost > 0) {
        await saveTransactionLine({
          transactionId:  txId,
          side:           'out',
          type:           'cash',
          qty:            1,
          unitPriceMyr:   totalCost,
          cardExternalId: null, cardName: null, cardNumber: null,
          cardSetName: null, cardLang: null, cardImageUrl: null,
          marketPriceMyr: null, priceSource: null,
          usdToMyrRate: USD_TO_MYR, eurToMyrRate: EUR_TO_MYR,
          sealedProductId: null, sealedName: null, sealedReferencePrice: null,
        });
      }

      bumpHistoryRev();
      await Promise.all([
        refreshAggregates(org.id),
        refreshStock(org.id),
      ]);

      notifications.show({
        message:   `${matched.length} card${matched.length !== 1 ? 's' : ''} imported successfully.`,
        color:     'green',
        autoClose: 3000,
      });
      handleClose();
    } catch (err) {
      notifications.show({ title: 'Import failed', message: err.message, color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const totalCost    = matched.reduce((sum, l) => sum + (l.unitPriceMyr || 0) * l.qty, 0);
  const totalFunds   = funds.reduce((sum, f) => sum + (f.amountMyr ?? 0), 0);
  const fundOnHand   = totalFunds + (metrics?.netCashFlow ?? 0);
  const insufficient = totalCost > 0 && totalCost > fundOnHand;

  const pct = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Import stock"
      size="md"
      closeOnClickOutside={step !== 'processing'}
      closeOnEscape={step !== 'processing'}
    >
      {/* ── Step 1: Upload ─────────────────────────────────────────────────── */}
      {step === 'upload' && (
        <Stack gap="md">
          <SegmentedControl
            value={fileType}
            onChange={(v) => { setFileType(v); setParseError(null); }}
            data={[
              { label: 'JSON', value: 'json' },
              { label: 'CSV',  value: 'csv'  },
            ]}
            fullWidth
            size="xs"
          />

          {fileType === 'json' ? (
            <Text size="sm" c="dimmed">
              Upload a JSON array where each object has{' '}
              <Text component="span" size="sm" c="violet.4" ff="monospace">product_name</Text>,{' '}
              <Text component="span" size="sm" c="violet.4" ff="monospace">discriminator</Text>,{' '}
              <Text component="span" size="sm" c="violet.4" ff="monospace">quantity</Text>, and{' '}
              <Text component="span" size="sm" c="violet.4" ff="monospace">paid_per_unit</Text>.
            </Text>
          ) : (
            <Text size="sm" c="dimmed">
              Upload a CSV with columns{' '}
              <Text component="span" size="sm" c="violet.4" ff="monospace">product_name</Text>,{' '}
              <Text component="span" size="sm" c="violet.4" ff="monospace">discriminator</Text>,{' '}
              <Text component="span" size="sm" c="violet.4" ff="monospace">quantity</Text>, and{' '}
              <Text component="span" size="sm" c="violet.4" ff="monospace">paid_per_unit</Text> as the header row.
            </Text>
          )}

          {parseError && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
              {parseError}
            </Alert>
          )}

          {fileType === 'json' ? (
            <FileButton onChange={handleFile} accept=".json,application/json">
              {(props) => (
                <Button {...props} variant="light" leftSection={<IconUpload size={14} />} fullWidth>
                  Select JSON file
                </Button>
              )}
            </FileButton>
          ) : (
            <FileButton onChange={handleFile} accept=".csv,text/csv">
              {(props) => (
                <Button {...props} variant="light" leftSection={<IconUpload size={14} />} fullWidth>
                  Select CSV file
                </Button>
              )}
            </FileButton>
          )}
        </Stack>
      )}

      {/* ── Step 2: Processing ─────────────────────────────────────────────── */}
      {step === 'processing' && (
        <Stack gap="md">
          <Text size="sm" fw={500}>
            Searching PokéWallet… {progress.current} / {progress.total}
          </Text>
          <Progress value={pct} animated size="sm" color="violet" />
          <Text size="xs" c="dimmed" truncate>
            {progress.label}
          </Text>
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            leftSection={<IconX size={12} />}
            onClick={handleCancel}
          >
            Cancel
          </Button>
        </Stack>
      )}

      {/* ── Step 3: Review ─────────────────────────────────────────────────── */}
      {step === 'review' && (
        <Stack gap="md">
          {/* Matched */}
          <Stack gap="xs">
            <Group gap="xs">
              <IconCheck size={14} color="var(--mantine-color-green-5)" />
              <Text size="sm" fw={500}>{matched.length} card{matched.length !== 1 ? 's' : ''} matched</Text>
            </Group>
            {matched.length > 0 && (
              <ScrollArea h={220}>
                <Stack gap="xs" pr="xs">
                  {matched.map((line, i) => (
                    <MatchedRow key={i} line={line} />
                  ))}
                </Stack>
              </ScrollArea>
            )}
          </Stack>

          {/* Unmatched */}
          {unmatched.length > 0 && (
            <>
              <Divider variant="dashed" />
              <Stack gap="xs">
                <Group gap="xs">
                  <IconX size={14} color="var(--mantine-color-red-5)" />
                  <Text size="sm" fw={500} c="red.4">
                    {unmatched.length} not found — will be skipped
                  </Text>
                </Group>
                <ScrollArea h={100}>
                  <Stack gap={4} pr="xs">
                    {unmatched.map((item, i) => (
                      <Text key={i} size="xs" c="dimmed">
                        {item.product_name}
                        {item.discriminator ? ` · ${item.discriminator}` : ''}
                        {item.set_name ? ` (${item.set_name})` : ''}
                      </Text>
                    ))}
                  </Stack>
                </ScrollArea>
              </Stack>
            </>
          )}

          {insufficient && (
            <Alert icon={<IconAlertCircle size={16} />} color="orange" variant="light">
              This import costs{' '}
              <Text component="span" fw={600} size="sm">MYR {fmtMoney(totalCost)}</Text>
              {' '}but current funds on hand are only{' '}
              <Text component="span" fw={600} size="sm">MYR {fmtMoney(fundOnHand)}</Text>.
              {' '}Add funds manually before or after importing if needed.
            </Alert>
          )}

          <Group justify="space-between" pt="xs">
            <Anchor size="xs" c="dimmed" onClick={() => setStep('upload')}>
              ← Upload a different file
            </Anchor>
            <Group gap="xs">
              <Button variant="subtle" color="gray" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                loading={saving}
                disabled={matched.length === 0}
                onClick={handleConfirm}
              >
                Import {matched.length} card{matched.length !== 1 ? 's' : ''}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
