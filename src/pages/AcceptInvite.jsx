import { useState, useEffect } from 'react';
import {
  Center, Paper, Stack, Title, Text,
  TextInput, PasswordInput, Button, Alert, Loader,
} from '@mantine/core';
import { IconAlertCircle, IconCheck } from '@tabler/icons-react';
import { supabase } from '../lib/supabase';
import { resolveUser, findPendingInviteByEmail, addOrgMember, acceptInvite } from '../lib/db';

/**
 * Landing page for magic-link invites.
 *
 * Supabase processes the magic-link token from the URL automatically before
 * this page renders. By the time onAuthStateChange fires, the user is already
 * authenticated. This page then:
 *  1. Waits for the Supabase session to resolve
 *  2. Looks up any pending invite for the user's email
 *  3. Links them to the org and marks the invite accepted
 *  4. Redirects to the main app
 *
 * If no pending invite is found the user is redirected normally and will
 * land on /no-access until an admin adds them.
 */
export default function AcceptInvite() {
  const [status,  setStatus]  = useState('loading'); // loading | naming | linking | done | error
  const [session, setSession] = useState(null);
  const [name,     setName]     = useState('');
  const [password, setPassword] = useState('');
  const [error,   setError]   = useState(null);

  // Wait for Supabase to resolve the magic-link session.
  // Uses onAuthStateChange instead of getSession() because Supabase PKCE flow
  // exchanges the ?code= param asynchronously — getSession() races and returns
  // null before the exchange completes, causing a false "invalid link" error.
  useEffect(() => {
    const hasCode = new URLSearchParams(window.location.search).has('code');
    let handled = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (handled) return;
      if (s && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        handled = true;
        setSession(s);
        const hasName = s.user.user_metadata?.display_name?.trim();
        setStatus(hasName ? 'linking' : 'naming');
      } else if (event === 'INITIAL_SESSION' && !s && !hasCode) {
        handled = true;
        setStatus('error');
        setError('This invite link is invalid or has expired. Please request a new one.');
      }
      // If INITIAL_SESSION fires with no session but ?code is present,
      // stay in 'loading' — SIGNED_IN will follow once the exchange completes.
    });

    return () => subscription.unsubscribe();
  }, []);

  // Once we have a session and a name, link to org
  useEffect(() => {
    if (status !== 'linking' || !session) return;
    linkToOrg(session.user);
  }, [status, session]);

  async function linkToOrg(authUser) {
    try {
      // Resolve (or create) the DB user record
      const dbUser = await resolveUser(authUser);
      if (!dbUser) throw new Error('Could not create user record.');

      // Look up pending invite for this email
      const invite = await findPendingInviteByEmail(authUser.email);
      if (invite) {
        await addOrgMember({ orgId: invite.orgId, userId: dbUser.id, role: invite.role });
        await acceptInvite(invite.id);
      }
      // Whether or not an invite was found, redirect.
      // AuthGuard will send them to /no-access if they're still not in an org.
      setStatus('done');
      setTimeout(() => { window.location.replace('/'); }, 1200);
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  async function handleNameSubmit(e) {
    e.preventDefault();
    if (!name.trim() || password.length < 8 || !session) return;
    try {
      await supabase.auth.updateUser({ data: { display_name: name.trim() }, password });
      // Refresh session so resolveUser gets the updated metadata
      const { data: { session: refreshed } } = await supabase.auth.getSession();
      setSession(refreshed);
      setStatus('linking');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Center h="100dvh" bg="dark.9">
      <Paper withBorder p="xl" w={360} radius="md">
        <Stack gap="lg">
          <Stack gap={4}>
            <Title order={2} size="h3" style={{ letterSpacing: '0.08em' }}>VENDOR BASE</Title>
            <Text size="xs" c="dimmed">Accepting your invite…</Text>
          </Stack>

          {error && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
              {error}
            </Alert>
          )}

          {status === 'loading' && (
            <Center py="md"><Loader color="violet" size="sm" /></Center>
          )}

          {status === 'naming' && (
            <form onSubmit={handleNameSubmit}>
              <Stack gap="sm">
                <TextInput
                  label="Your name"
                  placeholder="How you'll appear to teammates"
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                  required
                  autoFocus
                />
                <PasswordInput
                  label="Password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  minLength={8}
                  required
                />
                <Button type="submit" fullWidth mt="xs" disabled={!name.trim() || password.length < 8}>
                  Continue
                </Button>
              </Stack>
            </form>
          )}

          {(status === 'linking') && (
            <Center py="md"><Loader color="violet" size="sm" /></Center>
          )}

          {status === 'done' && (
            <Alert icon={<IconCheck size={16} />} color="green" variant="light">
              Account ready. Taking you to the app…
            </Alert>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}
