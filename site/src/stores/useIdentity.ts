import { create } from "zustand";
import { fetchMe } from "../lib/api";

// Signed-in identity + role, fetched once from /api/me at boot. NOT persisted —
// the role is authoritative only from the server each session, never from
// localStorage. Fail-closed: isAdmin stays false until the server confirms it,
// so the editing rail never flashes for a viewer (or before auth resolves).

interface IdentityState {
  email: string | null;
  isAdmin: boolean;
  loaded: boolean;
  load: () => Promise<void>;
}

export const useIdentity = create<IdentityState>((set, get) => ({
  email: null,
  isAdmin: false,
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const me = await fetchMe();
      set({ email: me.email, isAdmin: me.isAdmin, loaded: true });
    } catch {
      // Unreachable/unauthorized → remain a viewer, but stop showing "loading".
      set({ loaded: true });
    }
  },
}));
