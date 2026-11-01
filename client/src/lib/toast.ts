import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  message: string;
}

const TOAST_MS = 8_000;

// A tiny external store: anything (the SSE hook included) can raise a toast; `<Toasts />` shows them.
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function notify() {
  for (const l of listeners) l();
}

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

export function pushToast(message: string): number {
  const id = nextId++;
  toasts = [...toasts, { id, message }];
  timers.set(
    id,
    setTimeout(() => dismissToast(id), TOAST_MS),
  );
  notify();
  return id;
}

/** Current toasts, for code outside React (tests). */
export function getToasts(): Toast[] {
  return toasts;
}

/** Tests only. */
export function clearToasts() {
  for (const id of [...timers.keys()]) dismissToast(id);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => toasts,
  );
}
