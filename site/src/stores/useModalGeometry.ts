import { create } from "zustand";
import { persist } from "zustand/middleware";

// Remembers where the user last dragged/resized EntityRefineModal, across
// every use of it (library view/edit, add-incident, and any future caller) —
// one shared geometry, same idea as a window remembering its last position
// regardless of what's showing inside it. null x/y means "never moved yet,
// center it."

export const MODAL_DEFAULT_WIDTH = 512;
export const MODAL_DEFAULT_HEIGHT = 600;
export const MODAL_MIN_WIDTH = 340;
export const MODAL_MIN_HEIGHT = 280;

interface Geometry {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
}

interface ModalGeometryState {
  geometry: Geometry;
  setPosition: (x: number, y: number) => void;
  setSize: (width: number, height: number) => void;
}

export const useModalGeometry = create<ModalGeometryState>()(
  persist(
    (set) => ({
      geometry: { x: null, y: null, width: MODAL_DEFAULT_WIDTH, height: MODAL_DEFAULT_HEIGHT },
      setPosition: (x, y) => set((s) => ({ geometry: { ...s.geometry, x, y } })),
      setSize: (width, height) => set((s) => ({ geometry: { ...s.geometry, width, height } })),
    }),
    { name: "journal:entity-modal-geometry" },
  ),
);
