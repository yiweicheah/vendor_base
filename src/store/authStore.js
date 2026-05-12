import { create } from 'zustand';

// user shape: { uid, email, displayName, dbId, isSuperuser }
// uid         = Firebase Auth UID (String)
// dbId        = database UUID — set after resolveUser completes
// isSuperuser = true when uid matches VITE_SUPERUSER_UID

const useAuthStore = create((set) => ({
  user:    null,
  org:     null,
  role:    null,
  loading: true,

  setUser:    (user)      => set({ user, loading: false }),
  setOrg:     (org, role) => set({ org, role }),
  clearAuth:  ()          => set({ user: null, org: null, role: null, loading: false }),
  setLoading: (loading)   => set({ loading }),
}));

export default useAuthStore;
