import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Center,
  Paper,
  Stack,
  Text,
  PasswordInput,
  Button,
  Alert,
} from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { updatePassword } from '../lib/auth';
import logo from '../assets/logo.png';

export default function UpdatePassword() {
  const navigate = useNavigate();
  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [error,     setError]     = useState(null);
  const [loading,   setLoading]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await updatePassword(password);
      navigate('/sign-in', { replace: true });
    } catch (err) {
      setError(err.message ?? 'Failed to update password. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Center h="100dvh" bg="dark.9">
      <Paper withBorder p="xl" w={360} radius="md">
        <Stack gap="lg">

          <Stack gap={8} align="center">
            <img src={logo} alt="TCG Vendor Base" style={{ height: 48, objectFit: 'contain' }} />
            <Text size="xs" c="dimmed">
              Set a new password
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
              <PasswordInput
                label="New password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
                autoFocus
                autoComplete="new-password"
                minLength={8}
              />
              <PasswordInput
                label="Confirm password"
                value={confirm}
                onChange={(e) => setConfirm(e.currentTarget.value)}
                required
                autoComplete="new-password"
              />
              <Button type="submit" fullWidth loading={loading} mt="xs">
                Update password
              </Button>
            </Stack>
          </form>

        </Stack>
      </Paper>
    </Center>
  );
}
