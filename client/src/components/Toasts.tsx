import { dismissToast, useToasts } from "../lib/toast.ts";
import { CloseIcon } from "./Icons.tsx";

/** Bottom-right stack of short notices (a slot of yours expired, …). Each one dismisses itself. */
export function Toasts() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed right-4 z-20 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      style={{ bottom: "calc(var(--tabbar-height, 0px) + 1rem)" }}
      data-testid="toasts"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="glass-strong glass-in flex items-center gap-2 rounded-xl px-3 py-2 text-ink text-sm"
          data-testid="toast"
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-accent-soft lg:min-h-8 lg:min-w-8"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
          >
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  );
}
