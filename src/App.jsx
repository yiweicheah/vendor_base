import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Center, Loader } from '@mantine/core';
import { supabase } from './lib/supabase';
import useAuthStore from './store/authStore';
import useOrgStore from './store/orgStore';
import useCartStore from './store/cartStore';
import { resolveUser, loadAllMemberships, loadEvents, loadFunds, loadPaymentMethods, loadEventMiscCosts, loadFixedCosts, loadSealedProducts, loadMetrics, loadEventBreakdown, loadMonthlyPL, loadStock } from './lib/db';
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
          setLoading(true);
          Promise.all([
            loadEvents(initialMembership.org.id),
            loadFunds(initialMembership.org.id),
            loadPaymentMethods(initialMembership.org.id),
            loadEventMiscCosts(initialMembership.org.id),
            loadFixedCosts(initialMembership.org.id),
            loadSealedProducts(initialMembership.org.id),
            loadMetrics(initialMembership.org.id),
            loadEventBreakdown(initialMembership.org.id),
            loadMonthlyPL(initialMembership.org.id),
            loadStock(initialMembership.org.id),
          ]).then(([events, funds, paymentMethods, miscCosts, fixedCosts, sealedProducts, metrics, eventBreakdown, monthlyPL, stock]) => {
            setEvents(events);
            setFunds(funds);
            setPaymentMethods(paymentMethods);
            setMiscCosts(miscCosts);
            setFixedCosts(fixedCosts);
            setSealedProducts(sealedProducts);
            setMetrics(metrics);
            setEventBreakdown(eventBreakdown);
            setMonthlyPL(monthlyPL);
            setStock(stock);
            const savedEventId = localStorage.getItem('selectedEventId');
            if (savedEventId && events.some((e) => e.id === savedEventId)) {
              setActiveEventId(savedEventId);
            }
          }).finally(() => {
            setLoading(false);
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
    try {
      const [events, funds, paymentMethods, miscCosts, fixedCosts, sealedProducts, metrics, eventBreakdown, monthlyPL, stock] = await Promise.all([
        loadEvents(orgId),
        loadFunds(orgId),
        loadPaymentMethods(orgId),
        loadEventMiscCosts(orgId),
        loadFixedCosts(orgId),
        loadSealedProducts(orgId),
        loadMetrics(orgId),
        loadEventBreakdown(orgId),
        loadMonthlyPL(orgId),
        loadStock(orgId),
      ]);
      setEvents(events);
      setFunds(funds);
      setPaymentMethods(paymentMethods);
      setMiscCosts(miscCosts);
      setFixedCosts(fixedCosts);
      setSealedProducts(sealedProducts);
      setMetrics(metrics);
      setEventBreakdown(eventBreakdown);
      setMonthlyPL(monthlyPL);
      setStock(stock);
    } finally {
      setSwitchingOrg(false);
    }
  }

  if (authLoading) {
    return (
      <Center h="100dvh">
        <Loader color="violet" size="md" />
      </Center>
    );
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
