import {
  Modal, Stack, Text, Group, Paper, ThemeIcon, ScrollArea,
} from '@mantine/core';
import { IconPackage } from '@tabler/icons-react';
import useOrgStore from '../../store/orgStore';
import useCartStore from '../../store/cartStore';

export default function SealedPickerModal({ opened, onClose, side }) {
  const sealedProducts = useOrgStore((s) => s.sealedProducts);
  const sealedStockMap = useOrgStore((s) => s.stockMap);
  const { addLine }    = useCartStore();

  function pickProduct(product) {
    const found = sealedStockMap.get(product.name.toLowerCase());
    const stock = found?.type === 'sealed' ? found : null;
    addLine(side, {
      type:            'sealed',
      sealedName:      product.name,
      sealedCatalogId: product.id,
      qty:             1,
      unitPrice:       0,
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
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap="sm" wrap="nowrap">
                        <ThemeIcon variant="light" color="teal" size="sm" radius="sm">
                          <IconPackage size={13} />
                        </ThemeIcon>
                        <Text size="sm" fw={500}>{p.name}</Text>
                      </Group>
                      {side === 'out' && stock && (
                        <Text size="xs" c="dimmed">avg cost RM {stock.avgCost.toFixed(2)}</Text>
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
