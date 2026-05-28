import { useState, useEffect, useCallback } from 'react';
import {
  Box, ScrollArea, Stack, Text, Group, Badge,
  TextInput, Select, Button, ActionIcon, Paper,
  Divider, Anchor, CopyButton, Tooltip, Collapse,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { modals } from '@mantine/modals';
import { IconCopy, IconCheck, IconUserPlus, IconRefresh, IconChevronDown, IconChevronUp, IconTrash, IconPencil, IconX } from '@tabler/icons-react';
import { getOrgMembers, getOrgInvites, createInvite, isEmailAlreadyOrgMember, hasPendingOrgInvite, regenerateInvite, deleteOrgMember, updateInviteEmail, deleteInvite } from '../lib/db';
import { sendInviteLink } from '../lib/auth';
import useOrgStore from '../store/orgStore';
import useAuthStore from '../store/authStore';
import PaymentMethodSettings from '../components/Settings/PaymentMethodSettings';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_COLOR = { owner: 'violet', admin: 'blue', staff: 'gray' };
const ROLE_RANK  = { owner: 3, admin: 2, staff: 1 };

function canManage(actorRole, targetRole, isSuperuser) {
  if (isSuperuser) return true;
  return (ROLE_RANK[actorRole] ?? 0) > (ROLE_RANK[targetRole] ?? 0);
}

function RoleBadge({ role }) {
  return (
    <Badge color={ROLE_COLOR[role] ?? 'gray'} variant="light" size="xs">
      {role}
    </Badge>
  );
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-MY', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function isExpired(ts) {
  return new Date(ts) < new Date();
}

function inviteLink(token) {
  return `${window.location.origin}/accept-invite?token=${token}`;
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function MemberList({ members, myRole, myUserId, isSuperuser, onChanged }) {
  if (!members.length) {
    return <Text size="xs" c="dimmed">No members yet.</Text>;
  }

  function handleRemove(member) {
    modals.openConfirmModal({
      title: 'Remove member',
      children: <Text size="sm">Remove <b>{member.user.displayName || member.user.email}</b> from this organisation?</Text>,
      labels: { confirm: 'Remove', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await deleteOrgMember({ memberId: member.id });
          notifications.show({ message: 'Member removed.', color: 'red' });
          onChanged?.();
        } catch (err) {
          notifications.show({ title: 'Failed', message: err.message, color: 'red' });
        }
      },
    });
  }

  return (
    <Stack gap="xs">
      {members.map((m) => {
        const isSelf = m.user.id === myUserId;
        const canRemove = !isSelf && canManage(myRole, m.role, isSuperuser);
        return (
          <Group key={m.id} justify="space-between" wrap="nowrap">
            <Stack gap={1} style={{ minWidth: 0 }}>
              <Text size="sm" fw={500} truncate>{m.user.displayName || m.user.email}</Text>
              <Text size="xs" c="dimmed" truncate>{m.user.email}</Text>
            </Stack>
            <Group gap="xs" style={{ flexShrink: 0 }}>
              <RoleBadge role={m.role} />
              <Text size="xs" c="dimmed">{formatDate(m.joinedAt)}</Text>
              {canRemove && (
                <Tooltip label="Remove member" withArrow>
                  <ActionIcon variant="subtle" color="red" size="sm" onClick={() => handleRemove(m)}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          </Group>
        );
      })}
    </Stack>
  );
}

function InviteForm({ org, user, used, myRole, onCreated }) {
  const roleOptions = myRole === 'owner'
    ? [{ value: 'admin', label: 'Admin' }, { value: 'staff', label: 'Staff' }]
    : [{ value: 'staff', label: 'Staff' }];

  const [email,   setEmail]   = useState('');
  const [role,    setRole]    = useState('staff');
  const [loading, setLoading] = useState(false);

  const limit = org?.memberLimit ?? null;
  const atCapacity = limit != null && used >= limit;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !org?.id || !user?.dbId) return;

    setLoading(true);
    try {
      if (atCapacity) {
        notifications.show({ message: `Member limit reached (${used} / ${limit}).`, color: 'red' });
        return;
      }

      const normalised = email.trim().toLowerCase();
      const alreadyMember = await isEmailAlreadyOrgMember({ orgId: org.id, email: normalised });
      if (alreadyMember) {
        notifications.show({ message: 'This person is already a member of your organisation.', color: 'red' });
        return;
      }

      const alreadyInvited = await hasPendingOrgInvite({ orgId: org.id, email: normalised });
      if (alreadyInvited) {
        notifications.show({ message: 'A pending invite for this email already exists.', color: 'red' });
        return;
      }

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await createInvite({
        orgId:       org.id,
        email:       normalised,
        role,
        invitedById: user.dbId,
        expiresAt,
      });
      await sendInviteLink(normalised);
      setEmail('');
      onCreated(); // refetch invites to get the token
      notifications.show({ message: 'Invite sent.', color: 'green' });
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="sm">
        <TextInput
          label="Email"
          type="email"
          placeholder="colleague@example.com"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          required
          size="sm"
        />
        <Select
          label="Role"
          value={role}
          onChange={(v) => setRole(v ?? 'staff')}
          data={roleOptions}
          size="sm"
        />
        <Button
          type="submit"
          size="sm"
          leftSection={<IconUserPlus size={14} />}
          loading={loading}
          disabled={!email.trim() || atCapacity}
        >
          Generate invite link
        </Button>
      </Stack>
    </form>
  );
}

function PendingInviteRow({ invite, invitedById, myRole, isSuperuser, onChanged }) {
  const expired    = isExpired(invite.expiresAt);
  const accepted   = invite.acceptedAt != null;
  const link       = inviteLink(invite.token);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editEmail, setEditEmail] = useState(invite.email);
  const [savingEmail, setSavingEmail] = useState(false);

  const canManageInvite = canManage(myRole, invite.role, isSuperuser);

  async function handleRegenerate() {
    setBusy(true);
    try {
      await regenerateInvite({ inviteId: invite.id, invitedById });
      await sendInviteLink(invite.email);
      onChanged?.();
      notifications.show({ message: 'Invite resent.', color: 'green' });
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' });
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEmail() {
    const next = editEmail.trim().toLowerCase();
    if (!next || next === invite.email) { setEditing(false); return; }
    setSavingEmail(true);
    try {
      await updateInviteEmail({ inviteId: invite.id, email: next });
      notifications.show({ message: 'Invite email updated. Click resend to send a new link.', color: 'green' });
      setEditing(false);
      onChanged?.();
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' });
    } finally {
      setSavingEmail(false);
    }
  }

  function handleDelete() {
    modals.openConfirmModal({
      title: 'Delete invite',
      children: <Text size="sm">Revoke the pending invite for <b>{invite.email}</b>?</Text>,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await deleteInvite({ inviteId: invite.id });
          notifications.show({ message: 'Invite deleted.', color: 'red' });
          onChanged?.();
        } catch (err) {
          notifications.show({ title: 'Failed', message: err.message, color: 'red' });
        }
      },
    });
  }

  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <Stack gap={1} style={{ minWidth: 0, flex: 1 }}>
        {editing ? (
          <Group gap={4} wrap="nowrap">
            <TextInput
              type="email"
              value={editEmail}
              onChange={(e) => setEditEmail(e.currentTarget.value)}
              size="xs"
              style={{ flex: 1 }}
              autoFocus
            />
            <ActionIcon variant="subtle" color="green" size="sm" loading={savingEmail} onClick={handleSaveEmail}>
              <IconCheck size={14} />
            </ActionIcon>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => { setEditing(false); setEditEmail(invite.email); }}>
              <IconX size={14} />
            </ActionIcon>
          </Group>
        ) : (
          <Text size="sm" truncate>{invite.email}</Text>
        )}
        <Group gap="xs">
          <RoleBadge role={invite.role} />
          {accepted ? (
            <Text size="xs" c="green.4">Accepted</Text>
          ) : expired ? (
            <Text size="xs" c="red.4">Expired {formatDate(invite.expiresAt)}</Text>
          ) : (
            <Text size="xs" c="dimmed">Expires {formatDate(invite.expiresAt)}</Text>
          )}
        </Group>
      </Stack>

      {!accepted && !editing && (
        <Group gap={4} style={{ flexShrink: 0 }}>
          {!expired && (
            <CopyButton value={link} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied!' : 'Copy link'} withArrow>
                  <ActionIcon variant="subtle" color={copied ? 'green' : 'gray'} size="sm" onClick={copy}>
                    {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          )}
          <Tooltip label={expired ? 'Regenerate & resend' : 'Resend invite'} withArrow>
            <ActionIcon variant="subtle" color="violet" size="sm" loading={busy} onClick={handleRegenerate}>
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
          {canManageInvite && (
            <>
              <Tooltip label="Edit email" withArrow>
                <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => setEditing(true)}>
                  <IconPencil size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Delete invite" withArrow>
                <ActionIcon variant="subtle" color="red" size="sm" onClick={handleDelete}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Tooltip>
            </>
          )}
        </Group>
      )}
    </Group>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Org() {
  const org  = useOrgStore((s) => s.org);
  const role = useOrgStore((s) => s.role);
  const user = useAuthStore((s) => s.user);

  const [members, setMembers]   = useState([]);
  const [invites, setInvites]   = useState([]);
  const [loadingM, setLoadingM] = useState(true);
  const [loadingI, setLoadingI] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteOpen,   setInviteOpen]   = useState(false);

  const canInvite = role === 'owner' || role === 'admin';

  const pendingCount = invites.filter((i) => !i.acceptedAt && !isExpired(i.expiresAt)).length;
  const used = members.length + pendingCount;
  const memberLimit = org?.memberLimit ?? null;
  const atCapacity = memberLimit != null && used >= memberLimit;

  const fetchMembers = useCallback(async () => {
    if (!org?.id) return;
    try {
      const res = await getOrgMembers({ orgId: org.id });
      setMembers(res ?? []);
    } catch {
      // silently fail — members list stays empty
    } finally {
      setLoadingM(false);
    }
  }, [org?.id]);

  const fetchInvites = useCallback(async () => {
    if (!org?.id || !canInvite) { setLoadingI(false); return; }
    try {
      const res = await getOrgInvites({ orgId: org.id });
      setInvites(res ?? []);
    } catch {
      // silently fail
    } finally {
      setLoadingI(false);
    }
  }, [org?.id, canInvite]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);
  useEffect(() => { fetchInvites(); }, [fetchInvites]);

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <ScrollArea style={{ flex: 1 }} p="md">
        <Stack gap="lg" pb="md">

          {/* Members */}
          <Stack gap="sm">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.08em' }}>
              Members
            </Text>
            {loadingM
              ? <Text size="xs" c="dimmed">Loading…</Text>
              : <MemberList
                  members={members}
                  myRole={role}
                  myUserId={user?.dbId}
                  isSuperuser={user?.isSuperuser}
                  onChanged={fetchMembers}
                />}
          </Stack>

          {/* Invite form — admin/owner only */}
          {canInvite && (
            <>
              <Divider />
              <Stack gap="sm">
                <Group
                  justify="space-between"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSettingsOpen((v) => !v)}
                >
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.08em' }}>
                    Settings
                  </Text>
                  <ActionIcon variant="subtle" color="gray" size="xs">
                    {settingsOpen ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
                  </ActionIcon>
                </Group>
                <Collapse expanded={settingsOpen}>
                  <PaymentMethodSettings />
                </Collapse>
              </Stack>

              <Divider />
              <Stack gap="sm">
                <Group
                  justify="space-between"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setInviteOpen((v) => !v)}
                >
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.08em' }}>
                    Invite someone
                  </Text>
                  <ActionIcon variant="subtle" color="gray" size="xs">
                    {inviteOpen ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
                  </ActionIcon>
                </Group>
                <Collapse expanded={inviteOpen}>
                  <Stack gap="sm">
                    {memberLimit != null && (
                      <Text size="xs" c={atCapacity ? 'red.4' : 'dimmed'}>
                        {used} / {memberLimit} used
                      </Text>
                    )}
                    <InviteForm org={org} user={user} used={used} myRole={role} onCreated={fetchInvites} />

                    {loadingI ? (
                      <Text size="xs" c="dimmed">Loading…</Text>
                    ) : (() => {
                      const pending  = invites.filter((i) => !i.acceptedAt);
                      const accepted = invites.filter((i) =>  i.acceptedAt);
                      return (
                        <>
                          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.08em' }}>
                            Pending invites
                          </Text>
                          {pending.length === 0 ? (
                            <Text size="xs" c="dimmed">No pending invites.</Text>
                          ) : (
                            <Stack gap="sm">
                              {pending.map((inv) => (
                                <PendingInviteRow
                                  key={inv.id}
                                  invite={inv}
                                  invitedById={user.dbId}
                                  myRole={role}
                                  isSuperuser={user?.isSuperuser}
                                  onChanged={fetchInvites}
                                />
                              ))}
                            </Stack>
                          )}
                          {accepted.length > 0 && (
                            <>
                              <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.08em', marginTop: 4 }}>
                                Accepted invites
                              </Text>
                              <Stack gap="sm">
                                {accepted.map((inv) => (
                                  <PendingInviteRow
                                    key={inv.id}
                                    invite={inv}
                                    invitedById={user.dbId}
                                    myRole={role}
                                    isSuperuser={user?.isSuperuser}
                                    onChanged={fetchInvites}
                                  />
                                ))}
                              </Stack>
                            </>
                          )}
                        </>
                      );
                    })()}
                  </Stack>
                </Collapse>
              </Stack>
            </>
          )}

        </Stack>
      </ScrollArea>
    </Box>
  );
}
