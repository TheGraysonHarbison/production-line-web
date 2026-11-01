import { useEffect, useRef } from "react";
import { CloseIcon } from "./Icons.tsx";
import { PrinterList } from "./PrinterList.tsx";

/**
 * Tablet printer drawer (dev doc §11.1): a native <dialog> pinned to the left edge, so focus
 * trapping, Escape, and the backdrop come for free.
 */
export function PrintersDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="glass-strong glass-in m-0 h-dvh max-h-dvh w-[min(22rem,85vw)] max-w-none rounded-r-2xl border-l-0 p-0 text-ink"
      aria-labelledby="printers-drawer-title"
      data-testid="printers-drawer"
    >
      {open ? (
        <div className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <h2 id="printers-drawer-title" className="font-semibold text-lg">
              Printers
            </h2>
            <button
              type="button"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-accent-soft"
              onClick={onClose}
              aria-label="Close printers"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PrinterList bookable onBook={onClose} />
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
