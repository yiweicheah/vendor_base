import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Center, Loader, Stack, Text } from '@mantine/core';
import { supabase } from './lib/supabase';
import useAuthStore from './store/authStore';
import useOrgStore from './store/orgStore';
import useCartStore from './store/cartStore';
import { resolveUser, loadAllMemberships, loadEvents, loadFunds, loadPaymentMethods, loadEventMiscCosts, loadFixedCosts, loadSealedProducts, loadMetrics, loadEventBreakdown, loadMonthlyPL, loadStock } from './lib/db';
import { readOrgCache, writeOrgCache } from './lib/orgCache';
import { fetchExchangeRates } from './lib/exchangeRates';
import { isSuperuserUid } from './lib/superuser';
import AuthGuard from './components/AuthGuard';
import SuperuserGuard from './components/SuperuserGuard';
import Shell from './components/Layout/AppShell';
import Landing from './pages/Landing';
import SignIn from './pages/SignIn';
import AcceptInvite from './pages/AcceptInvite';
import NoAccess from './pages/NoAccess';
import ResetPassword from './pages/ResetPassword';
import UpdatePassword from './pages/UpdatePassword';
import NotFound from './pages/NotFound';
const CartPage       = lazy(() => import('./pages/Cart'));
const HistoryPage    = lazy(() => import('./pages/History'));
const DashboardPage  = lazy(() => import('./pages/Dashboard'));
const OrgPage        = lazy(() => import('./pages/Org'));
const AdminDashboard = lazy(() => import('./pages/Admin/AdminDashboard'));
const StockPage      = lazy(() => import('./pages/Stock'));
const UserPage       = lazy(() => import('./pages/User'));

// Seed the heavy aggregate fields (metrics / eventBreakdown / monthlyPL / stock)
// from localStorage so Dashboard / Stock can render immediately on boot or
// org switch, before the fresh RPCs land. Safe to call with no cached data —
// the store fields stay at their cleared defaults.
function hydrateOrgFromCache(orgId, { setMetrics, setEventBreakdown, setMonthlyPL, setStock }) {
  const cached = readOrgCache(orgId);
  if (!cached) return;
  if (cached.metrics)        setMetrics(cached.metrics);
  if (cached.eventBreakdown) setEventBreakdown(cached.eventBreakdown);
  if (cached.monthlyPL)      setMonthlyPL(cached.monthlyPL);
  if (cached.stock)          setStock(cached.stock);
}

async function loadCriticalOrgData(orgId, {
  setEvents, setFunds, setPaymentMethods, setMiscCosts, setFixedCosts, setSealedProducts,
}) {
  const [events, funds, paymentMethods, miscCosts, fixedCosts, sealedProducts] = await Promise.all([
    loadEvents(orgId),
    loadFunds(orgId),
    loadPaymentMethods(orgId),
    loadEventMiscCosts(orgId),
    loadFixedCosts(orgId),
    loadSealedProducts(orgId),
  ]);
  setEvents(events);
  setFunds(funds);
  setPaymentMethods(paymentMethods);
  setMiscCosts(miscCosts);
  setFixedCosts(fixedCosts);
  setSealedProducts(sealedProducts);
  return { events };
}

function loadHeavyAggregates(orgId, { setMetrics, setEventBreakdown, setMonthlyPL, setStock }) {
  loadMetrics(orgId).then((metrics) => {
    setMetrics(metrics);
    writeOrgCache(orgId, { metrics });
  }).catch((err) => console.error('loadMetrics:', err));
  loadEventBreakdown(orgId).then((eventBreakdown) => {
    setEventBreakdown(eventBreakdown);
    writeOrgCache(orgId, { eventBreakdown });
  }).catch((err) => console.error('loadEventBreakdown:', err));
  loadMonthlyPL(orgId).then((monthlyPL) => {
    setMonthlyPL(monthlyPL);
    writeOrgCache(orgId, { monthlyPL });
  }).catch((err) => console.error('loadMonthlyPL:', err));
  loadStock(orgId).then((stock) => {
    setStock(stock);
    writeOrgCache(orgId, { stock });
  }).catch((err) => console.error('loadStock:', err));
}

async function loadOrgData(orgId, deps) {
  deps.setLoading(true);
  try {
    const { events } = await loadCriticalOrgData(orgId, deps);
    const savedEventId = localStorage.getItem('selectedEventId');
    if (savedEventId && events.some((e) => e.id === savedEventId)) {
      deps.setActiveEventId(savedEventId);
    }
  } catch (err) {
    console.error('loadCriticalOrgData:', err);
  } finally {
    deps.setLoading(false);
  }
  loadHeavyAggregates(orgId, deps);
}

// First paint while session + user resolve. Supabase free-tier projects can
// take 30-120s on a cold start; show an explanation after a few seconds so
// the spinner isn't silently hanging.
function BootSpinner() {
  const [phase, setPhase] = useState(0); // 0=quiet, 1=waking, 2=still waking
  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 3000);
    const t2 = setTimeout(() => setPhase(2), 15000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  return (
    <Center h="100dvh">
      <Stack align="center" gap="sm">
        <Loader color="violet" size="md" />
        {phase >= 1 && (
          <Text size="sm" c="dimmed">
            {phase >= 2 ? 'Waking up the database (this can take up to a minute)…' : 'Waking up the database…'}
          </Text>
        )}
      </Stack>
    </Center>
  );
}

function MainApp({ onSwitchOrg, switchingOrg }) {
  const [view, setView] = useState('cart');
  const [historyMounted, setHistoryMounted] = useState(false);

  useEffect(() => { import('./pages/History'); }, []);

  function handleSetView(v) {
    if (v === 'history' && !historyMounted) setHistoryMounted(true);
    setView(v);
  }

  return (
    <Shell view={view} setView={handleSetView} onSwitchOrg={onSwitchOrg} onOpenUser={() => handleSetView('user')} switchingOrg={switchingOrg}>
      {view === 'cart'      && <CartPage />}
      <div style={{ display: view === 'history' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {historyMounted && <HistoryPage />}
      </div>
      {view === 'dashboard' && <DashboardPage />}
      {view === 'stock'     && <StockPage />}
      {view === 'team'      && <OrgPage />}
      {view === 'user'      && <UserPage onBack={() => handleSetView('cart')} />}
    </Shell>
  );
}

export default function App() {
  const [switchingOrg, setSwitchingOrg] = useState(false);
  const { user, setUser, clearAuth, loading: authLoading } = useAuthStore();
  const clearCart = useCartStore((s) => s.clearCart);
  const {
    org, memberships,
    setMembership, setMemberships, clearOrgData,
    setEvents, setFunds, setPaymentMethods, setActiveEventId,
    setMiscCosts, setFixedCosts, setSealedProducts,
    setMetrics, setEventBreakdown, setMonthlyPL, setStock,
    setLoading,
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
          localStorage.removeItem('selectedOrgId');
          localStorage.removeItem('selectedEventId');
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
        const savedOrgId = localStorage.getItem('selectedOrgId');
        const initialMembership =
          (savedOrgId && allMemberships.find((m) => m.org.id === savedOrgId)) ||
          allMemberships[0] ||
          null;

        setMemberships(allMemberships);
        if (initialMembership) {
          setMembership(initialMembership.org, initialMembership.role);
        }

        setUser({
          uid:         supabaseUser.id,
          email:       supabaseUser.email,
          displayName: dbUser?.displayName ?? '',
          dbId:        dbUser?.id ?? null,
          isSuperuser: false,
        });

        if (initialMembership) {
          hydrateOrgFromCache(initialMembership.org.id, {
            setMetrics, setEventBreakdown, setMonthlyPL, setStock,
          });
          loadOrgData(initialMembership.org.id, {
            setEvents, setFunds, setPaymentMethods, setMiscCosts, setFixedCosts, setSealedProducts,
            setMetrics, setEventBreakdown, setMonthlyPL, setStock,
            setActiveEventId, setLoading,
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
    localStorage.setItem('selectedOrgId', orgId);
    localStorage.removeItem('selectedEventId');
    setMembership(next.org, next.role);
    clearOrgData();
    clearCart();
    setSwitchingOrg(true);
    hydrateOrgFromCache(orgId, { setMetrics, setEventBreakdown, setMonthlyPL, setStock });
    try {
      await loadCriticalOrgData(orgId, {
        setEvents, setFunds, setPaymentMethods, setMiscCosts, setFixedCosts, setSealedProducts,
      });
    } finally {
      setSwitchingOrg(false);
    }
    loadHeavyAggregates(orgId, { setMetrics, setEventBreakdown, setMonthlyPL, setStock });
  }

  if (authLoading) {
    return <BootSpinner />;
  }

  const fallback = <Center h="100dvh"><Loader color="violet" size="md" /></Center>;

  return (
    <Suspense fallback={fallback}>
    <Routes>
      <Route path="/sign-in"        element={<SignIn />} />
      <Route path="/accept-invite"  element={<AcceptInvite />} />
      <Route path="/no-access"      element={<NoAccess />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/update-password" element={<UpdatePassword />} />
      <Route
        path="/admin/*"
        element={
          <SuperuserGuard>
            <AdminDashboard />
          </SuperuserGuard>
        }
      />
      <Route
        path="/"
        element={
          user ? (
            <AuthGuard>
              <MainApp onSwitchOrg={handleSwitchOrg} switchingOrg={switchingOrg} />
            </AuthGuard>
          ) : (
            <Landing />
          )
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  );
}
