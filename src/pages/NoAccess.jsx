import { Center, Stack, Title, Text, Button, ThemeIcon } from '@mantine/core';
import { Helmet } from 'react-helmet-async';
import { IconLock } from '@tabler/icons-react';
import { signOut } from '../lib/auth';
import { useNavigate, Navigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import useOrgStore from '../store/orgStore';

export default function NoAccess() {
  const navigate = useNavigate();
  const { user, loading } = useAuthStore();
  const { org } = useOrgStore();

  // Redirect away once auth resolves and the user has an org
  if (!loading && user && org) return <Navigate to="/" replace />;
  if (!loading && !user)       return <Navigate to="/sign-in" replace />;

  async function handleSignOut() {
    await signOut();
    navigate('/sign-in');
  }

  return (
    <>
      <Helmet>
        <title>No Access | TCG Vendor Base</title>
        <meta name="description" content="Your account is not linked to any organisation. Ask your admin to send you an invite." />
        <meta name="robots" content="noindex, follow" />
      </Helmet>
      <Center h="100dvh" bg="dark.9">
      <Stack align="center" gap="md" maw={300}>
        <ThemeIcon size={56} variant="light" color="gray" radius="xl">
          <IconLock size={28} />
        </ThemeIcon>
        <Title order={3} ta="center">No access</Title>
        <Text c="dimmed" size="sm" ta="center">
          Your account isn't linked to any organisation yet.
          Ask your admin to send you an invite link.
        </Text>
        <Button variant="subtle" color="gray" onClick={handleSignOut}>
          Sign out
        </Button>
      </Stack>
    </Center>
    </>
  );
}
