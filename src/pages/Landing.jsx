import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  Box,
  Container,
  Stack,
  Group,
  Title,
  Text,
  Button,
  Paper,
  SimpleGrid,
  ThemeIcon,
} from '@mantine/core';
import {
  IconPackage,
  IconShoppingCart,
  IconChartBar,
  IconUsers,
} from '@tabler/icons-react';
import logo from '../assets/logo.png';

const FEATURES = [
  {
    icon: IconPackage,
    title: 'Inventory Management',
    body: 'Track every card and sealed product with real-time stock levels.',
  },
  {
    icon: IconShoppingCart,
    title: 'Quick Checkout',
    body: 'Process trades and sales at events with a fast, touch-friendly cart.',
  },
  {
    icon: IconChartBar,
    title: 'Performance Dashboard',
    body: 'See your margins, top sellers, and event P&L at a glance.',
  },
  {
    icon: IconUsers,
    title: 'Team & Multi-Org',
    body: 'Invite teammates, manage roles, and run multiple stores from one account.',
  },
];

export default function Landing() {
  return (
    <>
      <Helmet>
        <title>TCG Vendor Base — Inventory, sales, and analytics for TCG vendors</title>
        <meta
          name="description"
          content="The all-in-one platform for trading card game vendors. Track inventory, process sales at events, and analyze performance — all in one place."
        />
        <link rel="canonical" href="https://tcgvendorbase.com/" />
        <meta name="robots" content="index, follow" />
        <meta property="og:title" content="TCG Vendor Base" />
        <meta
          property="og:description"
          content="Inventory, sales, and analytics for trading card game vendors."
        />
        <meta property="og:url" content="https://tcgvendorbase.com/" />
      </Helmet>

      <Box bg="dark.9" mih="100dvh">
        <Container size="md" py={{ base: 'xl', sm: 80 }}>
          <Stack gap={80}>

            <Stack gap="xl" align="center" ta="center">
              <img
                src={logo}
                alt="TCG Vendor Base"
                style={{ height: 64, objectFit: 'contain' }}
              />
              <Stack gap="sm" align="center">
                <Title order={1} size="h1" fw={700}>
                  TCG Vendor Base
                </Title>
                <Text size="lg" c="dimmed" maw={560}>
                  The all-in-one platform for trading card game vendors —
                  track inventory, process sales, and analyze performance.
                </Text>
              </Stack>
              <Group gap="sm" mt="sm">
                <Button component={Link} to="/sign-in" size="md">
                  Sign In
                </Button>
                <Button
                  component="a"
                  href="mailto:contact@tcgvendorbase.com?subject=TCG%20Vendor%20Base%20%E2%80%94%20Request%20access"
                  variant="default"
                  size="md"
                >
                  Request access
                </Button>
              </Group>
            </Stack>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <Paper key={title} withBorder p="lg" radius="md">
                  <Stack gap="sm">
                    <ThemeIcon size={40} radius="md" variant="light" color="violet">
                      <Icon size={22} />
                    </ThemeIcon>
                    <Text fw={600}>{title}</Text>
                    <Text size="sm" c="dimmed">
                      {body}
                    </Text>
                  </Stack>
                </Paper>
              ))}
            </SimpleGrid>

            <Text size="xs" c="dimmed" ta="center">
              © 2026 TCG Vendor Base
            </Text>

          </Stack>
        </Container>
      </Box>
    </>
  );
}
