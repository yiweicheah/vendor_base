import { useMemo, useState } from 'react';
import {
  Modal, Stack, TextInput, ScrollArea, Group, Text,
  Badge, Image, Box, UnstyledButton, Center, ThemeIcon, Anchor,
} from '@mantine/core';
import { IconSearch, IconPackage } from '@tabler/icons-react';
import { computeStockItems } from '../../lib/analytics';
import { normalizeStr } from '../../lib/tokenizer';
import useCartStore from '../../store/cartStore';
import useOrgStore from '../../store/orgStore';

function StockPickerRow({ item, onSelect }) {
  return (
    <UnstyledButton
      onClick={() => onSelect(item)}
      style={{ width: '100%' }}
    >
      <Group
        justify="space-between"
        wrap="nowrap"
        gap="sm"
        px="xs"
        py={6}
        style={{ borderRadius: 6 }}
        className="stock-picker-row"
      >
        {/* Thumbnail */}
        <Box style={{ flexShrink: 0 }}>
          {item.imageUrl ? (
            <Image src={item.imageUrl} w={28} h={39} radius="sm" fit="contain" />
          ) : (
            <Box
              w={28} h={39}
              bg="dark.6"
              style={{ borderRadius: 4 }}
            />
          )}
        </Box>

        {/* Identity */}
        <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={500} truncate>{item.name}</Text>
          <Text size="xs" c="dimmed" truncate>
            {[item.setName, item.number, item.lang].filter(Boolean).join(' · ')}
          </Text>
          <Text size="xs" c="dimmed">Avg RM {item.avgCost.toFixed(2)}</Text>
        </Stack>

        {/* Qty */}
        <Badge color="violet" variant="light" size="sm" style={{ flexShrink: 0 }}>
          ×{item.qty}
        </Badge>
      </Group>
    </UnstyledButton>
  );
}

export default function StockPickerModal({ opened, onClose, onSearchFallback }) {
  const transactions = useOrgStore((s) => s.transactions);
  const { addLine }  = useCartStore();
  const [query, setQuery] = useState('');

  const stockItems = useMemo(
    () => computeStockItems(transactions).filter((i) => i.type === 'card'),
    [transactions]
  );

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
      type:          'card',
      qty:           1,
      unitPrice:     item.avgCost,
      cardExternalId: item.key,
      cardName:      item.name,
      cardNumber:    item.number,
      setName:       item.setName,
      lang:          item.lang,
      imageUrl:      item.imageUrl,
      marketPrice:   item.avgMarket,
      priceSource:   null,
    });
    onClose();
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
      size="sm"
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

        <ScrollArea h={360} px="md">
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
            <Stack gap={2}>
              {filtered.map((item) => (
                <StockPickerRow key={item.key} item={item} onSelect={handleSelect} />
              ))}
            </Stack>
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
