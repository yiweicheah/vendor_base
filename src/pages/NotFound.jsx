import { Center, Stack, Title, Text, Button, ThemeIcon } from '@mantine/core';
import { Helmet } from 'react-helmet-async';
import { IconError404 } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <>
      <Helmet>
        <title>404 Not Found | TCG Vendor Base</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <Center h="100dvh" bg="dark.9">
        <Stack align="center" gap="md" maw={300}>
          <ThemeIcon size={56} variant="light" color="gray" radius="xl">
            <IconError404 size={28} />
          </ThemeIcon>
          <Title order={3} ta="center">Page not found</Title>
          <Text c="dimmed" size="sm" ta="center">
            The page you're looking for doesn't exist or has been moved.
          </Text>
          <Button variant="subtle" color="gray" onClick={() => navigate('/')}>
            Go home
          </Button>
        </Stack>
      </Center>
    </>
  );
}
