import { create } from 'zustand';

const useOrgStore = create((set) => ({
  org:             null,
  role:            null,
  memberships:     [],
  transactions:    [],
  events:          [],
  funds:           [],
  activeEventId:   null,
  loading:         false,
  error:           null,

  setMembership:    (org, role)       => set({ org, role }),
  setMemberships:   (memberships)     => set({ memberships }),
  setTransactions:  (txs)        => set({ transactions: txs }),
  setEvents:        (events)     => set({ events }),
  setFunds:         (funds)      => set({ funds }),
  addFundEntry:     (entry)      => set((s) => ({ funds: [entry, ...s.funds] })),
  addEvent:         (event)      => set((s) => ({ events: [event, ...s.events] })),
  setActiveEventId: (id)         => set({ activeEventId: id }),

  removeTransaction: (txId) =>
    set((s) => ({ transactions: s.transactions.filter((t) => t.id !== txId) })),

  updateTransactionNotes: (txId, notes) =>
    set((s) => ({
      transactions: s.transactions.map((t) =>
        t.id === txId ? { ...t, notes } : t
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

  clearOrgData: () => set({ transactions: [], events: [], funds: [], activeEventId: null }),

  clearOrg: () => set({
    org: null, role: null, memberships: [], transactions: [], events: [], funds: [],
    activeEventId: null,
  }),
  setLoading: (loading) => set({ loading }),
  setError:   (error)   => set({ error }),
}));

export default useOrgStore;
