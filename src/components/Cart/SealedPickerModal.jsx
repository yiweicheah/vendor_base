import {
  Modal, Stack, Text, Group, Paper, ThemeIcon, ScrollArea,
} from '@mantine/core';
import { IconPackage } from '@tabler/icons-react';
import useOrgStore from '../../store/orgStore';
import useCartStore from '../../store/cartStore';
import { rm } from '../../lib/format';

export default function SealedPickerModal({ opened, onClose, side, onPick }) {
  const sealedProducts = useOrgStore((s) => s.sealedProducts);
  const sealedStockMap = useOrgStore((s) => s.stockMap);
  const { addLine }    = useCartStore();

  function pickProduct(product) {
    if (onPick) {
      onPick(product);
      onClose();
      return;
    }
    const found = sealedStockMap.get(product.name.toLowerCase());
    const stock = found?.type === 'sealed' ? found : null;
    addLine(side, {
      type:            'sealed',
      sealedName:      product.name,
      sealedCatalogId: product.id,
      qty:             1,
      unitPrice:       product.recommendedRetailPriceMyr ?? 0,
      avgCost:         stock?.avgCost ?? null,
    });
    onClose();
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Add sealed product" size="lg">
      <Stack gap="sm">
        {sealedProducts.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="md">
            No sealed products yet. Create them on the Stock page.
          </Text>
        ) : (
          <ScrollArea h={480}>
            <Stack gap="xs">
              {sealedProducts.map((p) => {
                const found = sealedStockMap.get(p.name.toLowerCase());
                const stock = found?.type === 'sealed' ? found : null;
                return (
                  <Paper
                    key={p.id}
                    withBorder
                    p="sm"
                    radius="md"
                    style={{ cursor: 'pointer' }}
                    onClick={() => pickProduct(p)}
                  >
                    <Group justify="space-between" wrap="nowrap" align="flex-start">
                      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                        <ThemeIcon variant="light" color="teal" size="sm" radius="sm">
                          <IconPackage size={13} />
                        </ThemeIcon>
                        <Stack gap={0} style={{ minWidth: 0 }}>
                          <Text size="sm" fw={500}>{p.name}</Text>
                          {p.recommendedRetailPriceMyr != null && (
                            <Text size="xs" c="dimmed">RRP {rm(p.recommendedRetailPriceMyr)}</Text>
                          )}
                        </Stack>
                      </Group>
                      {side === 'out' && stock && (
                        <Text size="xs" c="dimmed">avg cost {rm(stock.avgCost)}</Text>
                      )}
                    </Group>
                  </Paper>
                );
              })}
            </Stack>
          </ScrollArea>
        )}
      </Stack>
    </Modal>
  );
}
