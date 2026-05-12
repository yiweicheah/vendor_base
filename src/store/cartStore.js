import { create } from 'zustand';

let lineIdCounter = 0;
function newId() {
  return `line_${++lineIdCounter}_${Date.now()}`;
}

const useCartStore = create((set, get) => ({
  inLines:  [],
  outLines: [],

  addLine: (side, line) => {
    const key = side === 'in' ? 'inLines' : 'outLines';
    set((s) => ({ [key]: [...s[key], { ...line, id: newId() }] }));
  },

  removeLine: (side, lineId) => {
    const key = side === 'in' ? 'inLines' : 'outLines';
    set((s) => ({ [key]: s[key].filter((l) => l.id !== lineId) }));
  },

  updateLine: (side, lineId, patch) => {
    const key = side === 'in' ? 'inLines' : 'outLines';
    set((s) => ({
      [key]: s[key].map((l) => l.id === lineId ? { ...l, ...patch } : l),
    }));
  },

  clearCart: () => set({ inLines: [], outLines: [] }),

  inTotal:  () => get().inLines.reduce((sum, l)  => sum + (l.unitPrice || 0) * l.qty, 0),
  outTotal: () => get().outLines.reduce((sum, l) => sum + (l.unitPrice || 0) * l.qty, 0),
}));

export default useCartStore;
