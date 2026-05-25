import { useMemo, useState } from 'react';
import {
  Modal, Stack, TextInput, ScrollArea, Text,
  Box, Center, ThemeIcon, Anchor, Overlay, Loader,
} from '@mantine/core';
import { IconSearch, IconPackage } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { normalizeStr } from '../../lib/tokenizer';
import useCartStore from '../../store/cartStore';
import useOrgStore from '../../store/orgStore';

function StockTile({ item, onSelect }) {
  const [selecting, setSelecting] = useState(false);

  async function handleTap() {
    if (selecting) return;
    setSelecting(true);
    try {
      await onSelect(item);
    } finally {
      setSelecting(false);
    }
  }

  return (
    <Box onClick={handleTap} style={{ cursor: 'pointer', userSelect: 'none' }}>
      <Box
        style={{
          position:     'relative',
          aspectRatio:  '245 / 337',
          background:   'var(--mantine-color-dark-6)',
          borderRadius: 4,
          overflow:     'hidden',
        }}
      >
        {item.imageUrl && (
          <img
            src={item.imageUrl}
            loading="lazy"
            alt={item.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}
        {selecting && (
          <Overlay backgroundOpacity={0.4} radius={4}>
            <Center h="100%">
              <Loader size="sm" color="violet" />
            </Center>
          </Overlay>
        )}
      </Box>
      <Box p={6} style={{ minHeight: 64 }}>
        <Text size="13px" fw={500} lineClamp={1}>{item.name}</Text>
        <Text size="11px" c="dimmed" lineClamp={1}>
          {[item.setName, item.number, item.lang].filter(Boolean).join(' · ')}
        </Text>
        <Text size="11px" c="teal.4" fw={500}>
          {item.avgMarket ? `RM ${item.avgMarket.toFixed(2)}` : 'No market data'}
          {item.avgMarket ? <Text span size="10px" c="dimmed" fw={400}> · market</Text> : null}
        </Text>
        <Text size="11px" c="dimmed">
          Cost RM {item.avgCost.toFixed(2)}
        </Text>
      </Box>
    </Box>
  );
}

export default function StockPickerModal({ opened, onClose, onSearchFallback }) {
  const stockMap     = useOrgStore((s) => s.stockMap);
  const { addLine }  = useCartStore();
  const [query, setQuery] = useState('');

  const stockItems = useMemo(() => {
    const items = [];
    for (const item of stockMap.values()) {
      if (item.type === 'card') items.push(item);
    }
    return items;
  }, [stockMap]);

  const filtered = useMemo(() => {
    const q = normalizeStr(query.trim().toLowerCase());
    if (!q) return stockItems;
    return stockItems.filter((item) =>
      normalizeStr(item.name.toLowerCase()).includes(q) ||
      normalizeStr((item.setName ?? '').toLowerCase()).includes(q) ||
      normalizeStr((item.number  ?? '').toLowerCase()).includes(q)
    );
  }, [stockItems, query]);

  function handleSelect(item) {
    addLine('out', {
      type:           'card',
      qty:            1,
      unitPrice:      item.avgMarket ?? item.avgCost,
      cardExternalId: item.key,
      cardName:       item.name,
      cardNumber:     item.number,
      setName:        item.setName,
      lang:           item.lang,
      imageUrl:       item.imageUrl,
      marketPrice:    item.avgMarket,
      avgCost:        item.avgCost,
      priceSource:    null,
    });
    notifications.show({
      message:   `${item.name} (${item.setName}/${item.number}) added to going out`,
      color:     'gray',
      autoClose: 2000,
    });
  }

  function handleClose() {
    setQuery('');
    onClose();
  }

  function handleFallback() {
    handleClose();
    onSearchFallback();
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Pick from stock"
      size="lg"
      styles={{ body: { padding: 0 } }}
    >
      <Stack gap={0}>
        <Box px="md" pt="md" pb="sm">
          <TextInput
            placeholder="Search stock…"
            leftSection={<IconSearch size={14} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            size="sm"
            autoFocus
          />
        </Box>

        <ScrollArea h={480} px="md">
          {filtered.length === 0 ? (
            <Center py="xl">
              <Stack align="center" gap="xs">
                <ThemeIcon color="dark" variant="light" size="xl" radius="xl">
                  <IconPackage size={20} />
                </ThemeIcon>
                <Text size="sm" c="dimmed">
                  {query ? 'No matches.' : 'No stock on hand.'}
                </Text>
              </Stack>
            </Center>
          ) : (
            <Box
              style={{
                display:             'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                columnGap:           8,
                rowGap:              12,
                paddingBottom:       12,
              }}
            >
              {filtered.map((item) => (
                <StockTile key={item.key} item={item} onSelect={handleSelect} />
              ))}
            </Box>
          )}
        </ScrollArea>

        <Box px="md" py="sm" style={{ borderTop: '1px solid var(--mantine-color-dark-5)' }}>
          <Text size="xs" c="dimmed">
            Card not in stock?{' '}
            <Anchor size="xs" c="violet.4" onClick={handleFallback}>
              Search PokéWallet instead
            </Anchor>
          </Text>
        </Box>
      </Stack>
    </Modal>
  );
}
