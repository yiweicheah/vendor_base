import { useState, useEffect, useCallback } from 'react';
import {
  Box, ScrollArea, Stack, Group, Text, Paper, Badge,
  Button, TextInput, NumberInput, Select, ActionIcon, Collapse,
  Divider, ThemeIcon, CopyButton, Tooltip, Alert,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { modals } from '@mantine/modals';
import {
  IconLogout, IconChevronDown, IconChevronUp,
  IconBuilding, IconUsers, IconPlus, IconCopy,
  IconCheck, IconAlertCircle, IconMail, IconRefresh,
  IconSettings, IconTrash, IconPencil, IconX,
} from '@tabler/icons-react';
import {
  getAllOrganizations, getAllUsers,
  getOrgMembers, getOrgInvites,
  createOrganization, addOrgMember, createInvite, isEmailAlreadyOrgMember, hasPendingOrgInvite, regenerateInvite,
  updateOrgMemberLimit, deleteOrgMember, updateInviteEmail, deleteInvite,
} from '../../lib/db';
import { signOut, sendInviteLink } from '../../lib/auth';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/authStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_COLOR = { owner: 'violet', admin: 'blue', staff: 'gray' };

function fmt(ts) {
  return new Date(ts).toLocaleDateString('en-MY', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function slugify(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function isExpired(ts) {
  return new Date(ts) < new Date();
}

function inviteLink(token) {
  return `${window.location.origin}/accept-invite?token=${token}`;
}

// ─── Org row ──────────────────────────────────────────────────────────────────

function OrgRow({ org, onChanged }) {
  const user = useAuthStore((s) => s.user);

  const [expanded,    setExpanded]    = useState(false);
  const [members,     setMembers]     = useState(null);
  const [invites,     setInvites]     = useState(null);
  const [showInvite,  setShowInvite]  = useState(false);

  // Invite form state
  const [invEmail,    setInvEmail]    = useState('');
  const [invRole,     setInvRole]     = useState('staff');
  const [invLoading,  setInvLoading]  = useState(false);
  const [resendingId, setResendingId] = useState(null);

  // Member-limit editor state
  const [showSettings, setShowSettings] = useState(false);
  const [memberLimit, setMemberLimit]   = useState(org.memberLimit ?? '');
  const [savingLimit, setSavingLimit]   = useState(false);

  // Inline invite-email edit state
  const [editingInviteId, setEditingInviteId] = useState(null);
  const [editEmail,       setEditEmail]       = useState('');
  const [savingEmail,     setSavingEmail]     = useState(false);

  async function handleExpand() {
    setExpanded((v) => !v);
    if (members !== null) return;
    try {
      const [mRes, iRes] = await Promise.all([
        getOrgMembers({ orgId: org.id }),
        getOrgInvites({ orgId: org.id }),
      ]);
      setMembers(mRes ?? []);
      setInvites(iRes ?? []);
    } catch (err) {
      console.error('OrgRow load error:', err);
      setMembers([]);
      setInvites([]);
    }
  }

  async function handleResend(inv) {
    setResendingId(inv.id);
    try {
      await regenerateInvite({ inviteId: inv.id, invitedById: user.dbId });
      await sendInviteLink(inv.email);
      const iRes = await getOrgInvites({ orgId: org.id });
      setInvites(iRes ?? []);
      notifications.show({ message: 'Invite resent.', color: 'green' });
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' });
    } finally {
      setResendingId(null);
    }
  }

  async function handleInvite(e) {
    e.preventDefault();
    if (!invEmail.trim() || !user?.dbId) return;
    setInvLoading(true);
    try {
      const normalised = invEmail.trim().toLowerCase();
      const alreadyMember = await isEmailAlreadyOrgMember({ orgId: org.id, email: normalised });
      if (alreadyMember) {
        notifications.show({ message: 'This person is already a member of this organisation.', color: 'red' });
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
        role:        invRole,
        invitedById: user.dbId,
        expiresAt,
      });
      await sendInviteLink(normalised);
      // Refresh invite list to show the new link
      const iRes = await getOrgInvites({ orgId: org.id });
      setInvites(iRes ?? []);
      setInvEmail('');
      setShowInvite(false);
      notifications.show({ message: 'Invite sent.', color: 'green' });
    } catch (err) {
      notifications.show({ title: 'Invite failed', message: err.message, color: 'red' });
    } finally {
      setInvLoading(false);
    }
  }

  async function refreshLists() {
    const [mRes, iRes] = await Promise.all([
      getOrgMembers({ orgId: org.id }),
      getOrgInvites({ orgId: org.id }),
    ]);
    setMembers(mRes ?? []);
    setInvites(iRes ?? []);
  }

  function handleRemoveMember(member) {
    modals.openConfirmModal({
      title: 'Remove member',
      children: <Text size="sm">Remove <b>{member.user.displayName || member.user.email}</b> from this organisation?</Text>,
      labels: { confirm: 'Remove', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await deleteOrgMember({ memberId: member.id });
          await refreshLists();
          notifications.show({ message: 'Member removed.', color: 'red' });
        } catch (err) {
          notifications.show({ title: 'Failed', message: err.message, color: 'red' });
        }
      },
    });
  }

  function handleDeleteInvite(inv) {
    modals.openConfirmModal({
      title: 'Delete invite',
      children: <Text size="sm">Revoke the pending invite for <b>{inv.email}</b>?</Text>,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await deleteInvite({ inviteId: inv.id });
          await refreshLists();
          notifications.show({ message: 'Invite deleted.', color: 'red' });
        } catch (err) {
          notifications.show({ title: 'Failed', message: err.message, color: 'red' });
        }
      },
    });
  }

  async function handleSaveInviteEmail(inv) {
    const next = editEmail.trim().toLowerCase();
    if (!next || next === inv.email) { setEditingInviteId(null); return; }
    setSavingEmail(true);
    try {
      await updateInviteEmail({ inviteId: inv.id, email: next });
      setEditingInviteId(null);
      await refreshLists();
      notifications.show({ message: 'Invite email updated. Click resend to send a new link.', color: 'green' });
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' });
    } finally {
      setSavingEmail(false);
    }
  }

  async function handleSaveLimit() {
    setSavingLimit(true);
    try {
      const next = memberLimit === '' || memberLimit == null ? null : Number(memberLimit);
      await updateOrgMemberLimit({ orgId: org.id, memberLimit: next });
      notifications.show({ message: 'Member limit updated.', color: 'green' });
      setShowSettings(false);
      onChanged?.();
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' });
    } finally {
      setSavingLimit(false);
    }
  }

  const pendingInvites = (invites ?? []).filter(
    (inv) => !inv.acceptedAt && !isExpired(inv.expiresAt)
  );

  return (
    <Paper withBorder p="sm" radius="md">
      {/* Header row — always visible */}
      <Group
        justify="space-between"
        wrap="nowrap"
        style={{ cursor: 'pointer' }}
        onClick={handleExpand}
      >
        <Stack gap={1} style={{ minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            <Text size="sm" fw={600} truncate>{org.name}</Text>
            {org.deletedAt && (
              <Badge color="red" variant="light" size="xs" style={{ flexShrink: 0 }}>deleted</Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed">{org.slug} · {fmt(org.createdAt)}</Text>
        </Stack>
        <ActionIcon variant="subtle" color="gray" size="sm">
          {expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </ActionIcon>
      </Group>

      <Collapse expanded={expanded}>
        <Divider my="sm" />

        {/* Settings */}
        <Stack gap={4} mb="sm">
          <Group justify="space-between">
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.06em' }}>Settings</Text>
            {!showSettings && (
              <Button
                variant="subtle" color="gray" size="xs"
                leftSection={<IconSettings size={12} />}
                onClick={() => { setMemberLimit(org.memberLimit ?? ''); setShowSettings(true); }}
              >
                Edit
              </Button>
            )}
          </Group>
          {!showSettings ? (
            <Text size="xs" c="dimmed">
              Member limit: {org.memberLimit ?? 'Unlimited'}
            </Text>
          ) : (
            <Stack gap="xs">
              <NumberInput
                label="Member limit"
                description="Counts current members + pending invites. Leave blank for unlimited."
                placeholder="Unlimited"
                value={memberLimit}
                onChange={(v) => setMemberLimit(v)}
                min={1}
                clampBehavior="strict"
                size="xs"
                allowNegative={false}
                allowDecimal={false}
              />
              <Group gap="xs">
                <Button size="xs" loading={savingLimit} onClick={handleSaveLimit}>Save</Button>
                <Button
                  variant="subtle" color="gray" size="xs"
                  onClick={() => { setShowSettings(false); setMemberLimit(org.memberLimit ?? ''); }}
                >
                  Cancel
                </Button>
              </Group>
            </Stack>
          )}
        </Stack>

        <Divider my="sm" />

        {/* Members */}
        {members === null ? (
          <Text size="xs" c="dimmed">Loading…</Text>
        ) : members.length === 0 ? (
          <Text size="xs" c="dimmed">No members.</Text>
        ) : (
          <Stack gap={4} mb="sm">
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.06em' }}>Members</Text>
            {members.map((m) => (
              <Group key={m.id} justify="space-between" wrap="nowrap">
                <Stack gap={0} style={{ minWidth: 0 }}>
                  <Text size="xs" truncate>{m.user.displayName || m.user.email}</Text>
                  {m.user.displayName && <Text size="10px" c="dimmed" truncate>{m.user.email}</Text>}
                </Stack>
                <Group gap="xs" style={{ flexShrink: 0 }}>
                  <Badge color={ROLE_COLOR[m.role] ?? 'gray'} variant="light" size="xs">{m.role}</Badge>
                  <Text size="10px" c="dimmed">{fmt(m.joinedAt)}</Text>
                  <Tooltip label="Remove member" withArrow>
                    <ActionIcon variant="subtle" color="red" size="xs" onClick={() => handleRemoveMember(m)}>
                      <IconTrash size={12} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            ))}
          </Stack>
        )}

        {/* Pending invites */}
        {pendingInvites.length > 0 && (
          <Stack gap={4} mb="sm">
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.06em' }}>Pending invites</Text>
            {pendingInvites.map((inv) => {
              const editingThis = editingInviteId === inv.id;
              return (
                <Group key={inv.id} justify="space-between" wrap="nowrap">
                  <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                    {editingThis ? (
                      <Group gap={4} wrap="nowrap">
                        <TextInput
                          type="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.currentTarget.value)}
                          size="xs"
                          style={{ flex: 1 }}
                          autoFocus
                        />
                        <ActionIcon variant="subtle" color="green" size="xs" loading={savingEmail} onClick={() => handleSaveInviteEmail(inv)}>
                          <IconCheck size={12} />
                        </ActionIcon>
                        <ActionIcon variant="subtle" color="gray" size="xs" onClick={() => setEditingInviteId(null)}>
                          <IconX size={12} />
                        </ActionIcon>
                      </Group>
                    ) : (
                      <Text size="xs" truncate>{inv.email}</Text>
                    )}
                    <Text size="10px" c="dimmed">Expires {fmt(inv.expiresAt)}</Text>
                  </Stack>
                  {!editingThis && (
                    <Group gap="xs" style={{ flexShrink: 0 }}>
                      <Badge color={ROLE_COLOR[inv.role] ?? 'gray'} variant="light" size="xs">{inv.role}</Badge>
                      <CopyButton value={inviteLink(inv.token)} timeout={2000}>
                        {({ copied, copy }) => (
                          <Tooltip label={copied ? 'Copied!' : 'Copy invite link'} withArrow>
                            <ActionIcon
                              variant="subtle"
                              color={copied ? 'green' : 'gray'}
                              size="xs"
                              onClick={copy}
                            >
                              {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </CopyButton>
                      <Tooltip label="Resend invite" withArrow>
                        <ActionIcon
                          variant="subtle"
                          color="violet"
                          size="xs"
                          loading={resendingId === inv.id}
                          onClick={() => handleResend(inv)}
                        >
                          <IconRefresh size={12} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Edit email" withArrow>
                        <ActionIcon
                          variant="subtle" color="gray" size="xs"
                          onClick={() => { setEditEmail(inv.email); setEditingInviteId(inv.id); }}
                        >
                          <IconPencil size={12} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Delete invite" withArrow>
                        <ActionIcon variant="subtle" color="red" size="xs" onClick={() => handleDeleteInvite(inv)}>
                          <IconTrash size={12} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  )}
                </Group>
              );
            })}
          </Stack>
        )}

        {/* Invite form toggle */}
        {!showInvite ? (
          <Button
            variant="subtle"
            color="violet"
            size="xs"
            leftSection={<IconMail size={12} />}
            onClick={() => setShowInvite(true)}
          >
            Invite someone
          </Button>
        ) : (
          <form onSubmit={handleInvite}>
            <Stack gap="xs">
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.06em' }}>New invite</Text>
              <TextInput
                placeholder="email@example.com"
                type="email"
                value={invEmail}
                onChange={(e) => setInvEmail(e.currentTarget.value)}
                required
                size="xs"
                autoFocus
              />
              <Group gap="xs">
                <Select
                  value={invRole}
                  onChange={(v) => setInvRole(v ?? 'staff')}
                  data={[
                    { value: 'owner', label: 'Owner' },
                    { value: 'admin', label: 'Admin' },
                    { value: 'staff', label: 'Staff' },
                  ]}
                  size="xs"
                  style={{ flex: 1 }}
                />
                <Button type="submit" size="xs" loading={invLoading} disabled={!invEmail.trim()}>
                  Create
                </Button>
                <Button
                  variant="subtle" color="gray" size="xs"
                  onClick={() => { setShowInvite(false); setInvEmail(''); }}
                >
                  Cancel
                </Button>
              </Group>
            </Stack>
          </form>
        )}
      </Collapse>
    </Paper>
  );
}

// ─── Create org form ──────────────────────────────────────────────────────────

function CreateOrgForm({ users, onCreated }) {
  const [name,       setName]       = useState('');
  const [slug,       setSlug]       = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [loading,    setLoading]    = useState(false);

  function handleNameChange(v) {
    setName(v);
    setSlug(slugify(v));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    setLoading(true);
    try {
      const orgResult = await createOrganization({ name: name.trim(), slug: slug.trim() });
      const orgId = orgResult?.id;
      if (!orgId) throw new Error('Org creation returned no ID');

      if (ownerEmail.trim()) {
        const owner = users.find(
          (u) => u.email.toLowerCase() === ownerEmail.trim().toLowerCase()
        );
        if (!owner) throw new Error(`No user found with email "${ownerEmail.trim()}"`);
        await addOrgMember({ orgId, userId: owner.id, role: 'owner' });
      }

      notifications.show({ message: `"${name.trim()}" created.`, color: 'green' });
      setName(''); setSlug(''); setOwnerEmail('');
      onCreated();
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
          label="Name" placeholder="Card Shop KL"
          value={name} onChange={(e) => handleNameChange(e.currentTarget.value)}
          required size="sm"
        />
        <TextInput
          label="Slug" placeholder="card-shop-kl"
          value={slug} onChange={(e) => setSlug(e.currentTarget.value)}
          required size="sm"
        />
        <TextInput
          label="Owner email (optional)" type="email"
          placeholder="owner@example.com"
          description="Must already have an account"
          value={ownerEmail} onChange={(e) => setOwnerEmail(e.currentTarget.value)}
          size="sm"
        />
        <Button type="submit" size="sm" loading={loading} leftSection={<IconPlus size={14} />}>
          Create organisation
        </Button>
      </Stack>
    </form>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ icon: Icon, children }) {
  return (
    <Group gap="xs">
      <ThemeIcon size="sm" variant="transparent" color="dimmed">
        <Icon size={14} />
      </ThemeIcon>
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.08em' }}>
        {children}
      </Text>
    </Group>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const navigate = useNavigate();

  const [orgs,       setOrgs]       = useState([]);
  const [users,      setUsers]      = useState([]);
  const [loadingO,   setLoadingO]   = useState(true);
  const [loadingU,   setLoadingU]   = useState(true);
  const [orgsError,  setOrgsError]  = useState(null);
  const [usersError, setUsersError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchOrgs = useCallback(async () => {
    setLoadingO(true);
    setOrgsError(null);
    try {
      const res = await getAllOrganizations();
      setOrgs(res ?? []);
    } catch (err) {
      console.error('getAllOrganizations error:', err);
      setOrgsError(err.message ?? 'Failed to load organisations');
    } finally {
      setLoadingO(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoadingU(true);
    setUsersError(null);
    try {
      const res = await getAllUsers();
      setUsers(res ?? []);
    } catch (err) {
      console.error('getAllUsers error:', err);
      setUsersError(err.message ?? 'Failed to load users');
    } finally {
      setLoadingU(false);
    }
  }, []);

  useEffect(() => { fetchOrgs(); fetchUsers(); }, [fetchOrgs, fetchUsers]);

  async function handleSignOut() {
    await signOut();
    navigate('/sign-in');
  }

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>

      {/* Header */}
      <Box
        px="md"
        style={{
          height: 48, flexShrink: 0, display: 'flex', alignItems: 'center',
          borderBottom: '1px solid var(--mantine-color-dark-5)',
          background: 'var(--mantine-color-dark-8)',
        }}
      >
        <Group justify="space-between" w="100%">
          <Text fw={700} size="sm" style={{ letterSpacing: '0.12em', color: 'var(--mantine-color-violet-4)' }}>
            VENDOR BASE ADMIN
          </Text>
          <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleSignOut}>
            <IconLogout size={15} />
          </ActionIcon>
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1 }} p="md">
        <Stack gap="lg" pb="md">

          {/* ── Organisations ─────────────────────────────────────────────── */}
          <Stack gap="sm">
            <Group justify="space-between">
              <SectionLabel icon={IconBuilding}>
                Organisations ({loadingO ? '…' : orgs.length})
              </SectionLabel>
              <Button
                size="xs" variant="subtle" color="violet"
                leftSection={<IconPlus size={12} />}
                onClick={() => setShowCreate((v) => !v)}
              >
                New
              </Button>
            </Group>

            {orgsError && (
              <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light" p="xs">
                <Text size="xs">{orgsError}</Text>
              </Alert>
            )}

            <Collapse expanded={showCreate}>
              <Paper withBorder p="md" radius="md" mb="sm">
                <CreateOrgForm
                  users={users}
                  onCreated={() => { fetchOrgs(); setShowCreate(false); }}
                />
              </Paper>
            </Collapse>

            {loadingO ? (
              <Text size="xs" c="dimmed">Loading…</Text>
            ) : !orgsError && orgs.length === 0 ? (
              <Text size="xs" c="dimmed">No organisations yet.</Text>
            ) : (
              <Stack gap="xs">
                {orgs.map((o) => <OrgRow key={o.id} org={o} onChanged={fetchOrgs} />)}
              </Stack>
            )}
          </Stack>

          <Divider />

          {/* ── Users ─────────────────────────────────────────────────────── */}
          <Stack gap="sm">
            <SectionLabel icon={IconUsers}>
              Users ({loadingU ? '…' : users.length})
            </SectionLabel>

            {usersError && (
              <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light" p="xs">
                <Text size="xs">{usersError}</Text>
              </Alert>
            )}

            {loadingU ? (
              <Text size="xs" c="dimmed">Loading…</Text>
            ) : !usersError && users.length === 0 ? (
              <Text size="xs" c="dimmed">No users yet.</Text>
            ) : (
              <Stack gap="xs">
                {users.map((u) => {
                  const memberships = u.organizationMembers ?? [];
                  return (
                    <Paper key={u.id} withBorder p="sm" radius="md">
                      <Group justify="space-between" wrap="nowrap">
                        <Stack gap={1} style={{ minWidth: 0 }}>
                          <Text size="sm" fw={500} truncate>{u.displayName || '—'}</Text>
                          <Text size="xs" c="dimmed" truncate>{u.email}</Text>
                        </Stack>
                        <Stack gap={2} align="flex-end" style={{ flexShrink: 0 }}>
                          {memberships.length === 0 ? (
                            <Text size="xs" c="dimmed">No org</Text>
                          ) : (
                            memberships.map((m, i) => (
                              <Group key={i} gap={4} wrap="nowrap">
                                <Text size="xs" c="dimmed" truncate maw={100}>{m.org.name}</Text>
                                <Badge color={ROLE_COLOR[m.role] ?? 'gray'} variant="light" size="xs">
                                  {m.role}
                                </Badge>
                              </Group>
                            ))
                          )}
                        </Stack>
                      </Group>
                    </Paper>
                  );
                })}
              </Stack>
            )}
          </Stack>

        </Stack>
      </ScrollArea>
    </Box>
  );
}
