import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  Center,
  Paper,
  Stack,
  Text,
  TextInput,
  PasswordInput,
  Button,
  Alert,
} from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { signIn } from '../lib/auth';
import useAuthStore from '../store/authStore';
import logo from '../assets/logo.png';

export default function SignIn() {
  const user       = useAuthStore((s) => s.user);
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState(null);
  const [loading,  setLoading]  = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(getAuthErrorMessage(err.code));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Helmet>
        <title>Sign In | TCG Vendor Base</title>
        <meta name="description" content="Sign in to TCG Vendor Base to manage your Trading Card Game vendor operations." />
        <link rel="canonical" href="https://tcgvendorbase.com/sign-in" />
        <meta name="robots" content="index, follow" />
        <meta property="og:title" content="Sign In | TCG Vendor Base" />
        <meta property="og:description" content="Sign in to manage your TCG vendor operations." />
        <meta property="og:url" content="https://tcgvendorbase.com/sign-in" />
      </Helmet>
      <Center h="100dvh" bg="dark.9">
      <Paper withBorder p="xl" w={360} radius="md">
        <Stack gap="lg">

          <Stack gap={8} align="center">
            <img src={logo} alt="TCG Vendor Base" style={{ height: 48, objectFit: 'contain' }} />
            <Text size="xs" c="dimmed">
              Sign in to your account
            </Text>
          </Stack>

          {error && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              color="red"
              variant="light"
            >
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <Stack gap="sm">
              <TextInput
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                required
                autoFocus
                autoComplete="email"
              />
              <PasswordInput
                label="Password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
                autoComplete="current-password"
              />
<Button
                type="submit"
                fullWidth
                loading={loading}
                mt="xs"
              >
                Sign in
              </Button>
            </Stack>
          </form>

          <Text size="xs" c="dimmed" ta="center">
            No account? Ask your admin for an invite link.
          </Text>

        </Stack>
      </Paper>
    </Center>
    </>
  );
}

function getAuthErrorMessage(code) {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection.';
    default:
      return 'Sign in failed. Try again.';
  }
}
