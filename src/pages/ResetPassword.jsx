import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  Center,
  Paper,
  Stack,
  Text,
  TextInput,
  Button,
  Alert,
  Anchor,
} from '@mantine/core';
import { IconAlertCircle, IconCircleCheck } from '@tabler/icons-react';
import { sendPasswordReset } from '../lib/auth';
import logo from '../assets/logo.png';

export default function ResetPassword() {
  const [email,   setEmail]   = useState('');
  const [error,   setError]   = useState(null);
  const [sent,    setSent]    = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err.message ?? 'Failed to send reset email. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Helmet>
        <title>Reset Password | TCG Vendor Base</title>
        <meta name="description" content="Reset your TCG Vendor Base password. Enter your email and we'll send you a reset link." />
        <link rel="canonical" href="https://tcgvendorbase.com/reset-password" />
        <meta name="robots" content="noindex, follow" />
        <meta property="og:title" content="Reset Password | TCG Vendor Base" />
        <meta property="og:description" content="Reset your TCG Vendor Base account password." />
        <meta property="og:url" content="https://tcgvendorbase.com/reset-password" />
      </Helmet>
      <Center h="100dvh" bg="dark.9">
      <Paper withBorder p="xl" w={360} radius="md">
        <Stack gap="lg">

          <Stack gap={8} align="center">
            <img src={logo} alt="TCG Vendor Base" style={{ height: 48, objectFit: 'contain' }} />
            <Text size="xs" c="dimmed">
              Reset your password
            </Text>
          </Stack>

          {sent ? (
            <Alert
              icon={<IconCircleCheck size={16} />}
              color="green"
              variant="light"
            >
              Check your email for a password reset link.
            </Alert>
          ) : (
            <>
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
                  <Button type="submit" fullWidth loading={loading} mt="xs">
                    Send reset link
                  </Button>
                </Stack>
              </form>
            </>
          )}

          <Text size="xs" c="dimmed" ta="center">
            <Anchor component={Link} to="/sign-in" size="xs">
              Back to sign in
            </Anchor>
          </Text>

        </Stack>
      </Paper>
    </Center>
    </>
  );
}
