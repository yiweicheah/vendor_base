import { create } from 'zustand';

const useOrgStore = create((set) => ({
  org:             null,
  role:            null,
  memberships:     [],
  transactions:    [],
  events:          [],
  funds:           [],
  paymentMethods:  [],
  activeEventId:   null,
  loading:         false,
  error:           null,

  setMembership:    (org, role)       => set({ org, role }),
  setMemberships:   (memberships)     => set({ memberships }),
  setTransactions:  (txs)        => set({ transactions: txs }),
  setEvents:        (events)     => set({ events }),
  setFunds:         (funds)      => set({ funds }),
  setPaymentMethods: (methods)   => set({ paymentMethods: methods }),
  addPaymentMethod:  (method)    => set((s) => ({ paymentMethods: [...s.paymentMethods, method] })),
  removePaymentMethod: (id)      => set((s) => ({ paymentMethods: s.paymentMethods.filter((m) => m.id !== id) })),
  addFundEntry:     (entry)      => set((s) => ({ funds: [entry, ...s.funds] })),
  updateFundEntry:  (id, amountMyr) =>
    set((s) => ({ funds: s.funds.map(f => f.id === id ? { ...f, amountMyr } : f) })),
  removeFundEntry:  (id) =>
    set((s) => ({ funds: s.funds.filter(f => f.id !== id) })),
  addEvent:         (event)      => set((s) => ({ events: [event, ...s.events] })),
  updateEvent:      (eventId, patch) =>
    set((s) => ({ events: s.events.map((e) => e.id === eventId ? { ...e, ...patch } : e) })),
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

  clearOrgData: () => set({ transactions: [], events: [], funds: [], paymentMethods: [], activeEventId: null }),

  clearOrg: () => set({
    org: null, role: null, memberships: [], transactions: [], events: [], funds: [],
    paymentMethods: [], activeEventId: null,
  }),
  setLoading: (loading) => set({ loading }),
  setError:   (error)   => set({ error }),
}));

export default useOrgStore;
