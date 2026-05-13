import { useState } from 'react';
import {
  Box, ScrollArea, Stack, Text, Group, Badge,
  TextInput, PasswordInput, Button, ActionIcon,
  Divider,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconChevronLeft, IconPencil, IconCheck, IconX } from '@tabler/icons-react';
import useAuthStore from '../store/authStore';
import useOrgStore from '../store/orgStore';
import { updateUserDisplayName } from '../lib/db';
import { updatePassword, signOut } from '../lib/auth';
import { supabase } from '../lib/supabase';

const ROLE_COLOR = { owner: 'violet', admin: 'blue', staff: 'gray' };

function RoleBadge({ role }) {
  return (
    <Badge color={ROLE_COLOR[role] ?? 'gray'} variant="light" size="xs">
      {role}
    </Badge>
  );
}

function DisplayNameField({ user, setUser }) {
  const [editing, setEditing] = useState(false);
  const [value,   setValue]   = useState(user.displayName || '');
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === user.displayName) { setEditing(false); return; }
    setLoading(true);
    try {
      await updateUserDisplayName({ dbId: user.dbId, displayName: trimmed });
      await supabase.auth.updateUser({ data: { display_name: trimmed } });
      setUser({ ...user, displayName: trimmed });
      setEditing(false);
      notifications.show({ message: 'Display name updated.', color: 'green', autoClose: 2000 });
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    setValue(user.displayName || '');
    setEditing(false);
  }

  if (editing) {
    return (
      <Group gap="xs" align="flex-end">
        <TextInput
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          size="sm"
          style={{ flex: 1 }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel(); }}
          autoFocus
        />
        <ActionIcon variant="subtle" color="green" loading={loading} onClick={handleSave}>
          <IconCheck size={16} />
        </ActionIcon>
        <ActionIcon variant="subtle" color="gray" onClick={handleCancel}>
          <IconX size={16} />
        </ActionIcon>
      </Group>
    );
  }

  return (
    <Group gap="xs" align="center">
      <Text size="sm" fw={500}>{user.displayName || <Text span c="dimmed" size="sm">Not set</Text>}</Text>
      <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => setEditing(true)}>
        <IconPencil size={14} />
      </ActionIcon>
    </Group>
  );
}

function ChangePasswordForm() {
  const [newPass,     setNewPass]     = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [loading,     setLoading]     = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (newPass !== confirmPass) {
      notifications.show({ message: 'Passwords do not match.', color: 'red' });
      return;
    }
    if (newPass.length < 6) {
      notifications.show({ message: 'Password must be at least 6 characters.', color: 'red' });
      return;
    }
    setLoading(true);
    try {
      await updatePassword(newPass);
      setNewPass('');
      setConfirmPass('');
      notifications.show({ message: 'Password updated.', color: 'green', autoClose: 2000 });
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="sm">
        <PasswordInput
          label="New password"
          value={newPass}
          onChange={(e) => setNewPass(e.currentTarget.value)}
          size="sm"
          required
        />
        <PasswordInput
          label="Confirm password"
          value={confirmPass}
          onChange={(e) => setConfirmPass(e.currentTarget.value)}
          size="sm"
          required
        />
        <Button type="submit" size="sm" loading={loading} disabled={!newPass || !confirmPass}>
          Update password
        </Button>
      </Stack>
    </form>
  );
}

export default function User({ onBack }) {
  const user    = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const role    = useOrgStore((s) => s.role);

  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <Group px="md" py="sm" gap="xs">
        <ActionIcon variant="subtle" color="gray" onClick={onBack}>
          <IconChevronLeft size={18} />
        </ActionIcon>
        <Text fw={600} size="sm">Profile</Text>
      </Group>

      <ScrollArea style={{ flex: 1 }} p="md">
        <Stack gap="lg" pb="md">

          <Stack gap="sm">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.08em' }}>
              Account
            </Text>
            <Stack gap="xs">
              <Stack gap={2}>
                <Text size="xs" c="dimmed">Display name</Text>
                <DisplayNameField user={user} setUser={setUser} />
              </Stack>
              <Stack gap={2}>
                <Text size="xs" c="dimmed">Email</Text>
                <Text size="sm">{user?.email}</Text>
              </Stack>
              {role && (
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">Role</Text>
                  <RoleBadge role={role} />
                </Stack>
              )}
            </Stack>
          </Stack>

          <Divider />

          <Stack gap="sm">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.08em' }}>
              Change password
            </Text>
            <ChangePasswordForm />
          </Stack>

          <Divider />

          <Stack gap="sm">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.08em' }}>
              Session
            </Text>
            <Button
              color="red"
              variant="light"
              size="sm"
              loading={signingOut}
              onClick={handleSignOut}
            >
              Sign out
            </Button>
          </Stack>

        </Stack>
      </ScrollArea>
    </Box>
  );
}
