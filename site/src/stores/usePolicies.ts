import { create } from "zustand";
import { persist } from "zustand/middleware";

// Series-wide style directives (the @@policy verb). Active policies are injected
// into every prose operation's prompt so refinements stay consistent across the
// whole memoir. Persisted locally.

export interface Policy {
  id: string;
  text: string;
  active: boolean;
  createdAt: string;
}

let seq = 0;
const nextId = () => `p${(seq += 1)}`;

interface PolicyState {
  policies: Policy[];
  addPolicy: (text: string) => void;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  activeTexts: () => string[];
}

export const usePolicies = create<PolicyState>()(
  persist(
    (set, get) => ({
      policies: [],
      addPolicy: (text) =>
        set((s) => ({
          policies: [
            ...s.policies,
            { id: nextId(), text: text.trim(), active: true, createdAt: new Date().toISOString() },
          ],
        })),
      toggle: (id) =>
        set((s) => ({
          policies: s.policies.map((p) => (p.id === id ? { ...p, active: !p.active } : p)),
        })),
      remove: (id) => set((s) => ({ policies: s.policies.filter((p) => p.id !== id) })),
      activeTexts: () => get().policies.filter((p) => p.active).map((p) => p.text),
    }),
    { name: "journal:policies" },
  ),
);
