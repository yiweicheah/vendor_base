import { useState, useEffect } from 'react';
import { Modal, Stack, Text, Group, Box, Skeleton, Divider } from '@mantine/core';
import { getCardDetail, getTcgplayerImageUrl } from '../../lib/pokewallet';
import { getRates } from '../../lib/exchangeRates';

function PriceRow({ label, value }) {
  if (value == null) return null;
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="xs" fw={500}>RM {value.toFixed(2)}</Text>
    </Group>
  );
}

function PriceSection({ card }) {
  const { USD_TO_MYR, EUR_TO_MYR } = getRates();

  const tcg = (card?.tcgplayer?.prices ?? []).filter(
    (p) => p.low_price != null || p.market_price != null || p.high_price != null
  );

  const cm = (card?.cardmarket?.prices ?? []).filter(
    (p) => p.low != null || p.avg30 != null || p.trend != null
  );

  if (!tcg.length && !cm.length) return null;

  return (
    <>
      <Divider />
      <Stack gap="sm">
        {tcg.length > 0 && (
          <Stack gap={6}>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.06em' }}>
              TCGPlayer
            </Text>
            {tcg.map((p) => (
              <Stack key={p.sub_type_name} gap={3}>
                <Text size="xs" fw={500}>{p.sub_type_name}</Text>
                <PriceRow label="Low"    value={p.low_price    != null ? +(p.low_price    * USD_TO_MYR).toFixed(2) : null} />
                <PriceRow label="Market" value={p.market_price != null ? +(p.market_price * USD_TO_MYR).toFixed(2) : null} />
                <PriceRow label="High"   value={p.high_price   != null ? +(p.high_price   * USD_TO_MYR).toFixed(2) : null} />
              </Stack>
            ))}
          </Stack>
        )}

        {cm.length > 0 && (
          <Stack gap={6}>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.06em' }}>
              Cardmarket
            </Text>
            {cm.map((p) => (
              <Stack key={p.variant_type} gap={3}>
                <Text size="xs" fw={500} tt="capitalize">{p.variant_type}</Text>
                <PriceRow label="Low"     value={p.low   != null ? +(p.low   * EUR_TO_MYR).toFixed(2) : null} />
                <PriceRow label="30d avg" value={p.avg30 != null ? +(p.avg30 * EUR_TO_MYR).toFixed(2) : null} />
                <PriceRow label="Trend"   value={p.trend != null ? +(p.trend * EUR_TO_MYR).toFixed(2) : null} />
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    </>
  );
}

export default function CardDetailModal({ cardExternalId, fallbackImageUrl, onClose }) {
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!cardExternalId) { setCard(null); return; }
    let cancelled = false;
    setLoading(true);
    setCard(null);
    getCardDetail(cardExternalId)
      .then((data) => { if (!cancelled) { setCard(data); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cardExternalId]);

  const imageUrl = card?.tcgplayer?.url
    ? getTcgplayerImageUrl(card.tcgplayer.url)
    : fallbackImageUrl ?? null;

  return (
    <Modal
      opened={!!cardExternalId}
      onClose={onClose}
      size="xs"
      centered
      padding="md"
      styles={{ header: { paddingBottom: 0 } }}
      title={
        loading
          ? <Skeleton height={16} width={140} />
          : <Text size="sm" fw={600}>{card?.card_info?.name ?? '—'}</Text>
      }
    >
      <Stack gap="sm">
        <Box
          style={{
            aspectRatio: '245/337',
            background: 'var(--mantine-color-dark-6)',
            borderRadius: '4.4%',
            overflow: 'hidden',
          }}
        >
          {loading && <Skeleton style={{ width: '100%', height: '100%' }} />}
          {!loading && imageUrl && (
            <img
              src={imageUrl}
              alt={card?.card_info?.name ?? ''}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )}
        </Box>

        {!loading && card && (
          <>
            <Stack gap={2}>
              <Text size="xs" c="dimmed">
                {[card.card_info?.set_name, card.card_info?.card_number]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {card.card_info?.rarity && (
                <Text size="xs" c="dimmed">{card.card_info.rarity}</Text>
              )}
            </Stack>
            <PriceSection card={card} />
          </>
        )}
      </Stack>
    </Modal>
  );
}
