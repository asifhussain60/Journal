import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  useModalGeometry,
  MODAL_MIN_WIDTH,
  MODAL_MIN_HEIGHT,
} from "../stores/useModalGeometry";

// Generic view/edit/refine/approve modal — a "standard tool" for any feature
// that needs "show labeled fields, optionally edit them, optionally AI-refine
// them, optionally approve/persist them." Knows nothing about incidents,
// libraries, or any other domain concept; every call site owns its own state
// and API calls. Built on @radix-ui/react-dialog, already an installed
// dependency (previously unused) — same primitive family as the Tooltip
// already used in OperationsPanel.tsx.
//
// Draggable (by its title bar) and resizable (bottom-right handle); the last
// position/size is remembered across every open, via useModalGeometry.

export interface EntityField {
  key: string;
  label: string;
  multiline?: boolean;
}

export interface EntityRefineModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  fields: EntityField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  readOnly?: boolean;
  onRefine?: () => void | Promise<void>;
  refining?: boolean;
  onApprove?: () => void | Promise<void>;
  approving?: boolean;
  extraActions?: ReactNode;
}

export function EntityRefineModal({
  open,
  onClose,
  title,
  fields,
  values,
  onChange,
  readOnly,
  onRefine,
  refining,
  onApprove,
  approving,
  extraActions,
}: EntityRefineModalProps) {
  const geometry = useModalGeometry((s) => s.geometry);
  const setPosition = useModalGeometry((s) => s.setPosition);
  const setSize = useModalGeometry((s) => s.setSize);

  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [size, setLocalSize] = useState({ width: geometry.width, height: geometry.height });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(
    null,
  );

  // Re-center (or restore) every time the modal opens — not while it stays open.
  useEffect(() => {
    if (!open) return;
    const width = geometry.width;
    const height = geometry.height;
    const x = geometry.x ?? Math.max(0, (window.innerWidth - width) / 2);
    const y = geometry.y ?? Math.max(0, (window.innerHeight - height) / 2);
    setPos({ x, y });
    setLocalSize({ width, height });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onDragPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  }
  function onDragPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const { startX, startY, origX, origY } = dragRef.current;
    setPos({ x: origX + (e.clientX - startX), y: origY + (e.clientY - startY) });
  }
  function onDragPointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current = null;
    setPosition(pos.x, pos.y);
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function onResizePointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origW: size.width,
      origH: size.height,
    };
  }
  function onResizePointerMove(e: React.PointerEvent) {
    if (!resizeRef.current) return;
    const { startX, startY, origW, origH } = resizeRef.current;
    setLocalSize({
      width: Math.max(MODAL_MIN_WIDTH, origW + (e.clientX - startX)),
      height: Math.max(MODAL_MIN_HEIGHT, origH + (e.clientY - startY)),
    });
  }
  function onResizePointerUp(e: React.PointerEvent) {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    setSize(size.width, size.height);
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          style={{ left: pos.x, top: pos.y, width: size.width, height: size.height }}
          className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-line-strong bg-ops-surface shadow-2xl"
        >
          <div
            onPointerDown={onDragPointerDown}
            onPointerMove={onDragPointerMove}
            onPointerUp={onDragPointerUp}
            className="flex shrink-0 cursor-move select-none items-center justify-between gap-4 border-b border-line px-5 py-3"
          >
            <Dialog.Title className="font-display text-lg font-semibold text-text">
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="shrink-0 text-text-muted hover:text-text" aria-label="Close">
                ✕
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <div className="flex flex-col gap-3">
              {fields.map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block text-xs text-text-secondary">{f.label}</label>
                  {readOnly ? (
                    <p className="whitespace-pre-wrap rounded-md border border-line bg-bg px-3 py-2 text-sm text-text">
                      {values[f.key] || "—"}
                    </p>
                  ) : f.multiline ? (
                    <textarea
                      value={values[f.key] ?? ""}
                      onChange={(e) => onChange(f.key, e.target.value)}
                      rows={3}
                      className="w-full resize-none rounded-md border border-line bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
                    />
                  ) : (
                    <input
                      value={values[f.key] ?? ""}
                      onChange={(e) => onChange(f.key, e.target.value)}
                      className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-5 py-3">
            {extraActions}
            {!readOnly && onRefine && (
              <button
                onClick={onRefine}
                disabled={refining}
                className="rounded-md border border-line bg-ops-button px-3 py-1.5 text-xs text-text transition-colors hover:bg-ops-button-hover disabled:opacity-40"
              >
                {refining ? "Refining…" : "Refine"}
              </button>
            )}
            {!readOnly && onApprove && (
              <button
                onClick={onApprove}
                disabled={approving}
                className="ml-auto rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast disabled:opacity-40"
              >
                {approving ? "Saving…" : "Approve"}
              </button>
            )}
          </div>

          <div
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
            aria-hidden
            className="absolute bottom-0 right-0 h-6 w-6 cursor-nwse-resize"
            style={{
              background:
                "linear-gradient(135deg, transparent 0%, transparent 40%, var(--line-strong) 40%, var(--line-strong) 48%, transparent 48%, transparent 60%, var(--line-strong) 60%, var(--line-strong) 68%, transparent 68%)",
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
