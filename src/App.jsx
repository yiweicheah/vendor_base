import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Center, Loader } from '@mantine/core';
import { supabase } from './lib/supabase';
import useAuthStore from './store/authStore';
import useOrgStore from './store/orgStore';
import { resolveUser, loadAllMemberships, loadTransactions, loadEvents, loadFunds } from './lib/db';
import { fetchExchangeRates } from './lib/exchangeRates';
import { isSuperuserUid } from './lib/superuser';
import AuthGuard from './components/AuthGuard';
import SuperuserGuard from './components/SuperuserGuard';
import Shell from './components/Layout/AppShell';
import SignIn from './pages/SignIn';
import AcceptInvite from './pages/AcceptInvite';
import NoAccess from './pages/NoAccess';
import CartPage from './pages/Cart';
import HistoryPage from './pages/History';
import DashboardPage from './pages/Dashboard';
import TeamPage from './pages/Team';
import AdminDashboard from './pages/Admin/AdminDashboard';
import StockPage from './pages/Stock';

function MainApp({ onSwitchOrg }) {
  const [view, setView] = useState('cart');
  return (
    <Shell view={view} setView={setView} onSwitchOrg={onSwitchOrg}>
      {view === 'cart'      && <CartPage />}
      {view === 'history'   && <HistoryPage />}
      {view === 'dashboard' && <DashboardPage />}
      {view === 'stock'     && <StockPage />}
      {view === 'team'      && <TeamPage />}
    </Shell>
  );
}

export default function App() {
  const { setUser, clearAuth, loading: authLoading } = useAuthStore();
  const {
    org, memberships,
    setMembership, setMemberships, clearOrgData,
    setTransactions, setEvents, setFunds,
    clearOrg,
  } = useOrgStore();

  useEffect(() => {
    fetchExchangeRates();
    const rateInterval = setInterval(fetchExchangeRates, 60 * 60 * 1000);

    async function handleSession(session) {
      try {
        if (!session) {
          clearAuth();
          clearOrg();
          return;
        }

        const supabaseUser = session.user;
        const superuser    = isSuperuserUid(supabaseUser.id);

        const dbUser = await resolveUser(supabaseUser);

        if (superuser) {
          setUser({
            uid:         supabaseUser.id,
            email:       supabaseUser.email,
            displayName: dbUser?.displayName ?? '',
            dbId:        dbUser?.id ?? null,
            isSuperuser: true,
          });
          return;
        }

        const allMemberships = dbUser ? await loadAllMemberships(dbUser.id) : [];
        const firstMembership = allMemberships[0] ?? null;

        setMemberships(allMemberships);
        if (firstMembership) {
          setMembership(firstMembership.org, firstMembership.role);
        }

        setUser({
          uid:         supabaseUser.id,
          email:       supabaseUser.email,
          displayName: dbUser?.displayName ?? '',
          dbId:        dbUser?.id ?? null,
          isSuperuser: false,
        });

        if (firstMembership) {
          Promise.all([
            loadTransactions(firstMembership.org.id),
            loadEvents(firstMembership.org.id),
            loadFunds(firstMembership.org.id),
          ]).then(([txs, events, funds]) => {
            setTransactions(txs);
            setEvents(events);
            setFunds(funds);
          });
        }
      } catch (err) {
        console.error('handleSession error:', err);
        clearAuth(); // always escape the loading state
        clearOrg();
      }
    }

    // Page refresh: explicitly read the stored session.
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Skip — getSession() handles this on page load
        if (event === 'INITIAL_SESSION') return;
        handleSession(session);
      }
    );

    return () => {
      subscription.unsubscribe();
      clearInterval(rateInterval);
    };
  }, []); // eslint-disable-line

  async function handleSwitchOrg(orgId) {
    const next = memberships.find((m) => m.org.id === orgId);
    if (!next || next.org.id === org?.id) return;
    setMembership(next.org, next.role);
    clearOrgData();
    const [txs, events, funds] = await Promise.all([
      loadTransactions(orgId),
      loadEvents(orgId),
      loadFunds(orgId),
    ]);
    setTransactions(txs);
    setEvents(events);
    setFunds(funds);
  }

  if (authLoading) {
    return (
      <Center h="100dvh">
        <Loader color="violet" size="md" />
      </Center>
    );
  }

  return (
    <Routes>
      <Route path="/sign-in"       element={<SignIn />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/no-access"     element={<NoAccess />} />
      <Route
        path="/admin/*"
        element={
          <SuperuserGuard>
            <AdminDashboard />
          </SuperuserGuard>
        }
      />
      <Route
        path="/*"
        element={
          <AuthGuard>
            <MainApp onSwitchOrg={handleSwitchOrg} />
          </AuthGuard>
        }
      />
    </Routes>
  );
}
