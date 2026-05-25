import { create } from 'zustand';
import { buildStockMapFromRows } from '../lib/analytics';
import { loadMetrics, loadEventBreakdown, loadMonthlyPL, loadStock } from '../lib/db';

const EMPTY_STOCK_MAP = new Map();

const useOrgStore = create((set) => ({
  org:             null,
  role:            null,
  memberships:     [],
  transactions:    [],
  stock:           [],
  stockMap:        EMPTY_STOCK_MAP,
  events:          [],
  funds:           [],
  paymentMethods:  [],
  miscCosts:       [],
  fixedCosts:      [],
  sealedProducts:  [],
  activeEventId:   null,
  metrics:         null,
  eventBreakdown:  [],
  monthlyPL:       [],
  loading:         false,
  error:           null,

  setMembership:    (org, role)       => set({ org, role }),
  setMemberships:   (memberships)     => set({ memberships }),
  setTransactions:  (txs)        => set({ transactions: txs }),
  setStock:         (rows)       => set({ stock: rows, stockMap: buildStockMapFromRows(rows) }),
  refreshStock:     async (orgId) => {
    const rows = await loadStock(orgId);
    set({ stock: rows, stockMap: buildStockMapFromRows(rows) });
  },
  setEvents:        (events)     => set({ events }),
  setFunds:         (funds)      => set({ funds }),
  setMetrics:        (metrics)        => set({ metrics }),
  setEventBreakdown: (eventBreakdown) => set({ eventBreakdown }),
  setMonthlyPL:      (monthlyPL)      => set({ monthlyPL }),
  refreshAggregates: async (orgId) => {
    const [metrics, eventBreakdown, monthlyPL] = await Promise.all([
      loadMetrics(orgId), loadEventBreakdown(orgId), loadMonthlyPL(orgId),
    ]);
    set({ metrics, eventBreakdown, monthlyPL });
  },
  setPaymentMethods: (methods)   => set({ paymentMethods: methods }),
  setMiscCosts:    (costs)  => set({ miscCosts: costs }),
  addMiscCost:     (cost)   => set((s) => ({ miscCosts: [...s.miscCosts, cost] })),
  updateMiscCost:  (id, patch) => set((s) => ({ miscCosts: s.miscCosts.map((c) => c.id === id ? { ...c, ...patch } : c) })),
  removeMiscCost:  (id)    => set((s) => ({ miscCosts: s.miscCosts.filter((c) => c.id !== id) })),
  setSealedProducts:    (products) => set({ sealedProducts: products }),
  addSealedProduct:     (p)        => set((s) => ({ sealedProducts: [...s.sealedProducts, p].sort((a, b) => a.name.localeCompare(b.name)) })),
  updateSealedProduct:  (updated)  => set((s) => ({ sealedProducts: s.sealedProducts.map((p) => p.id === updated.id ? updated : p).sort((a, b) => a.name.localeCompare(b.name)) })),
  removeSealedProduct:  (id)       => set((s) => ({ sealedProducts: s.sealedProducts.filter((p) => p.id !== id) })),
  setFixedCosts:   (costs)  => set({ fixedCosts: costs }),
  addFixedCost:    (cost)   => set((s) => ({ fixedCosts: [cost, ...s.fixedCosts] })),
  updateFixedCost: (id, patch) => set((s) => ({ fixedCosts: s.fixedCosts.map((c) => c.id === id ? { ...c, ...patch } : c) })),
  removeFixedCost: (id)    => set((s) => ({ fixedCosts: s.fixedCosts.filter((c) => c.id !== id) })),
  addPaymentMethod:  (method)    => set((s) => ({ paymentMethods: [...s.paymentMethods, method] })),
  removePaymentMethod: (id)      => set((s) => ({ paymentMethods: s.paymentMethods.filter((m) => m.id !== id) })),
  addFundEntry:     (entry)      => set((s) => ({ funds: [entry, ...s.funds] })),
  updateFundEntry:  (id, patch) =>
    set((s) => ({ funds: s.funds.map(f => f.id === id ? { ...f, ...patch } : f) })),
  removeFundEntry:  (id) =>
    set((s) => ({ funds: s.funds.filter(f => f.id !== id) })),
  addEvent:         (event)      => set((s) => ({ events: [event, ...s.events] })),
  updateEvent:      (eventId, patch) =>
    set((s) => ({ events: s.events.map((e) => e.id === eventId ? { ...e, ...patch } : e) })),
  removeEvent:      (eventId)    => set((s) => ({ events: s.events.filter((e) => e.id !== eventId) })),
  setActiveEventId: (id)         => set({ activeEventId: id }),

  removeTransaction: (txId) =>
    set((s) => ({ transactions: s.transactions.filter((t) => t.id !== txId) })),

  updateTransactionNotes: (txId, notes) =>
    set((s) => ({
      transactions: s.transactions.map((t) =>
        t.id === txId ? { ...t, notes } : t
      ),
    })),

  updateTransactionEvent: (txId, event) =>
    set((s) => ({
      transactions: s.transactions.map((t) =>
        t.id === txId ? { ...t, event } : t
      ),
    })),

  updateTransactionPaymentMethod: (txId, paymentMethod) =>
    set((s) => ({
      transactions: s.transactions.map((t) =>
        t.id === txId ? { ...t, paymentMethod } : t
      ),
    })),

  updateTransactionLine: (txId, lineId, patch) =>
    set((s) => ({
      transactions: s.transactions.map((t) =>
        t.id !== txId ? t : {
          ...t,
          transactionLines: t.transactionLines.map((l) =>
            l.id === lineId ? { ...l, ...patch } : l
          ),
        }
      ),
    })),

  removeTransactionLine: (txId, lineId) =>
    set((s) => ({
      transactions: s.transactions.map((t) =>
        t.id !== txId ? t : {
          ...t,
          transactionLines: t.transactionLines.filter((l) => l.id !== lineId),
        }
      ),
    })),

  addTransactionLine: (txId, line) =>
    set((s) => ({
      transactions: s.transactions.map((t) =>
        t.id !== txId ? t : {
          ...t,
          transactionLines: [...t.transactionLines, line],
        }
      ),
    })),

  clearOrgData: () => set({ transactions: [], stock: [], stockMap: EMPTY_STOCK_MAP, events: [], funds: [], paymentMethods: [], miscCosts: [], fixedCosts: [], sealedProducts: [], activeEventId: null, metrics: null, eventBreakdown: [], monthlyPL: [] }),

  clearOrg: () => set({
    org: null, role: null, memberships: [], transactions: [], stock: [], stockMap: EMPTY_STOCK_MAP,
    events: [], funds: [], paymentMethods: [], miscCosts: [], fixedCosts: [], sealedProducts: [], activeEventId: null,
    metrics: null, eventBreakdown: [], monthlyPL: [],
  }),
  setLoading: (loading) => set({ loading }),
  setError:   (error)   => set({ error }),
}));

export default useOrgStore;
