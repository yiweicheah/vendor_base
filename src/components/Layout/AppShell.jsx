import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  AppShell,
  Group,
  Text,
  UnstyledButton,
  Stack,
  Box,
  Menu,
  ActionIcon,
  LoadingOverlay,
} from '@mantine/core';
import logo from '../../assets/logo.png';
import {
  IconShoppingCart,
  IconHistory,
  IconChartBar,
  IconPackage,
  IconUsers,
  IconChevronDown,
  IconCheck,
  IconUser,
} from '@tabler/icons-react';
import { getRates, getLastFetched } from '../../lib/exchangeRates';
import useOrgStore from '../../store/orgStore';

const VIEW_TITLES = {
  cart:      'Cart',
  history:   'History',
  dashboard: 'Dashboard',
  stock:     'Stock',
  team:      'Team',
  user:      'Account',
};

const NAV_ITEMS = [
  { id: 'cart',      label: 'Cart',      Icon: IconShoppingCart },
  { id: 'history',   label: 'History',   Icon: IconHistory },
  { id: 'dashboard', label: 'Dashboard', Icon: IconChartBar },
  { id: 'stock',     label: 'Stock',     Icon: IconPackage },
  { id: 'team',      label: 'Team',      Icon: IconUsers },
];

function NavButton({ item, active, onClick }) {
  const { label, Icon } = item;
  return (
    <UnstyledButton onClick={onClick} style={{ flex: 1 }}>
      <Stack
        align="center"
        gap={4}
        py="xs"
        style={{
          color: active
            ? 'var(--mantine-color-violet-4)'
            : 'var(--mantine-color-dark-2)',
          borderTop: active
            ? '2px solid var(--mantine-color-violet-4)'
            : '2px solid transparent',
          transition: 'color 0.15s ease',
        }}
      >
        <Icon size={20} />
        <Text size="xs" fw={active ? 600 : 400}>{label}</Text>
      </Stack>
    </UnstyledButton>
  );
}

function OrgSwitcher({ onSwitchOrg }) {
  const org         = useOrgStore((s) => s.org);
  const memberships = useOrgStore((s) => s.memberships);

  if (!org) return null;

  if (memberships.length <= 1) {
    return <Text size="xs" c="dimmed" truncate maw={140}>{org.name}</Text>;
  }

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <UnstyledButton>
          <Group gap={4} wrap="nowrap">
            <Text size="xs" c="dimmed" truncate maw={120}>{org.name}</Text>
            <IconChevronDown size={12} color="var(--mantine-color-dark-2)" />
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        {memberships.map((m) => (
          <Menu.Item
            key={m.org.id}
            onClick={() => onSwitchOrg?.(m.org.id)}
            rightSection={m.org.id === org.id ? <IconCheck size={12} /> : null}
          >
            <Stack gap={1}>
              <Text size="sm">{m.org.name}</Text>
              <Text size="xs" c="dimmed">{m.role}</Text>
            </Stack>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

export default function Shell({ view, setView, onSwitchOrg, onOpenUser, switchingOrg, children }) {
  const [, forceRender] = useState(0);

  // Re-render once after mount to pick up fetched exchange rates
  useEffect(() => {
    const t = setTimeout(() => forceRender((n) => n + 1), 3000);
    return () => clearTimeout(t);
  }, []);

  const rates     = getRates();
  const fetched   = getLastFetched();
  const rateLabel = fetched
    ? `USD ${rates.USD_TO_MYR.toFixed(2)} · EUR ${rates.EUR_TO_MYR.toFixed(2)} · ${fetched.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: false })}`
    : `USD ${rates.USD_TO_MYR.toFixed(2)} · EUR ${rates.EUR_TO_MYR.toFixed(2)}`;

  return (
    <>
      <Helmet>
        <title>{VIEW_TITLES[view] ?? 'App'} | TCG Vendor Base</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
    <AppShell
      header={{ height: 48 }}
      footer={{ height: 80 }}
      padding={0}
    >
      <AppShell.Header
        style={{
          borderBottom: '1px solid var(--mantine-color-dark-5)',
          background:   'var(--mantine-color-dark-8)',
        }}
      >
        <Group h="100%" px="md" justify="space-between">
          <img src={logo} alt="TCG Vendor Base" style={{ height: 28, objectFit: 'contain' }} />
          <Group gap="xs">
            <OrgSwitcher onSwitchOrg={onSwitchOrg} />
            <ActionIcon variant="subtle" color="gray" onClick={onOpenUser}>
              <IconUser size={18} />
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main
        style={{
          display:       'flex',
          flexDirection: 'column',
          height:        'calc(100dvh - 48px - 80px)',
          overflow:      'hidden',
          position:      'relative',
        }}
      >
        <LoadingOverlay visible={switchingOrg} zIndex={10} overlayProps={{ blur: 2 }} loaderProps={{ color: 'violet' }} />
        <Box style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {children}
        </Box>
      </AppShell.Main>

      <AppShell.Footer
        style={{
          borderTop:  '1px solid var(--mantine-color-dark-5)',
          background: 'var(--mantine-color-dark-8)',
        }}
      >
        <Stack gap={0} h="100%">
          <Group gap={0} align="stretch" style={{ flex: 1 }}>
            {NAV_ITEMS.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={view === item.id}
                onClick={() => setView(item.id)}
              />
            ))}
          </Group>
          <Text size="10px" c="dimmed" ta="center" pb={2}>
            {rateLabel}
          </Text>
        </Stack>
      </AppShell.Footer>
    </AppShell>
    </>
  );
}
