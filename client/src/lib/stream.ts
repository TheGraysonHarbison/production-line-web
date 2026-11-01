import type { Printer, PublicUser, Slot } from "@production-line/shared";
import { overlaps } from "@production-line/shared";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { meQueryKey, metaQueryKey } from "./auth.tsx";
import { printersQueryKey, settingsQueryKey, slotsQueryKey, usersQueryKey } from "./data.ts";
import { pushToast } from "./toast.ts";

export type StreamStatus = "connecting" | "live" | "reconnecting" | "closed";

// Tiny external store so any component can show the connection state.
let status: StreamStatus = "connecting";
const listeners = new Set<() => void>();
function setStatus(next: StreamStatus) {
  if (status === next) return;
  status = next;
  for (const l of listeners) l();
}
export function useStreamStatus(): StreamStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

type SlotsKey = readonly ["slots", string, string];

function upsertSlot(qc: QueryClient, slot: Slot) {
  for (const query of qc.getQueryCache().findAll({ queryKey: slotsQueryKey.all })) {
    const [, from, to] = query.queryKey as SlotsKey;
    if (typeof from !== "string" || typeof to !== "string") continue;
    qc.setQueryData<Slot[]>(query.queryKey, (old) => {
      if (!old) return old;
      const without = old.filter((s) => s.id !== slot.id);
      if (!overlaps(slot, { start_at: from, end_at: to })) return without;
      return [...without, slot].sort((x, y) => x.start_at.localeCompare(y.start_at) || x.id - y.id);
    });
  }
}

function removeSlot(qc: QueryClient, id: number) {
  qc.setQueriesData<Slot[]>({ queryKey: slotsQueryKey.all }, (old) =>
    old?.filter((s) => s.id !== id),
  );
}

/** Refetch everything a reconnect could have missed (dev doc §5). */
export function refetchAfterReconnect(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: slotsQueryKey.all });
  void qc.invalidateQueries({ queryKey: printersQueryKey });
  void qc.invalidateQueries({ queryKey: metaQueryKey });
  void qc.invalidateQueries({ queryKey: meQueryKey });
}

/** Applies one server event to the query cache. Exported for tests. */
export function applyStreamEvent(
  qc: QueryClient,
  name: string,
  data: unknown,
  meId: number | undefined,
) {
  switch (name) {
    case "slot.created":
    case "slot.updated":
      upsertSlot(qc, (data as { slot: Slot }).slot);
      break;
    case "slot.deleted":
      removeSlot(qc, (data as { slot: Slot }).slot.id);
      break;
    case "slot.expired": {
      const slot = (data as { slot: Slot }).slot;
      removeSlot(qc, slot.id);
      // Dev doc §3.4 / roadmap Phase 8: the owner, if online, gets a small note.
      if (slot.user.id === meId) {
        const names = slot.printers.map((p) => p.name).join(", ");
        pushToast(`${slot.name} finished${names ? ` on ${names}` : ""} and left the schedule.`);
      }
      break;
    }
    case "printer.created":
    case "printer.updated": {
      const printer = (data as { printer: Printer }).printer;
      qc.setQueryData<Printer[]>(printersQueryKey, (old) => {
        if (!old) return old;
        const without = old.filter((p) => p.id !== printer.id);
        return [...without, printer].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        );
      });
      // Slots embed printers (names, visibility), so refresh them too.
      void qc.invalidateQueries({ queryKey: slotsQueryKey.all });
      break;
    }
    case "printer.deleted": {
      const printer = (data as { printer: Printer }).printer;
      qc.setQueryData<Printer[]>(printersQueryKey, (old) =>
        old?.filter((p) => p.id !== printer.id),
      );
      break;
    }
    case "settings.updated":
      void qc.invalidateQueries({ queryKey: metaQueryKey });
      void qc.invalidateQueries({ queryKey: settingsQueryKey });
      break;
    case "user.updated": {
      const user = (data as { user: PublicUser }).user;
      qc.setQueryData<PublicUser[]>(usersQueryKey, (old) =>
        old?.map((u) => (u.id === user.id ? user : u)),
      );
      if (user.id === meId) void qc.invalidateQueries({ queryKey: meQueryKey });
      void qc.invalidateQueries({ queryKey: slotsQueryKey.all });
      break;
    }
    case "user.deleted": {
      const user = (data as { user: PublicUser }).user;
      qc.setQueryData<PublicUser[]>(usersQueryKey, (old) => old?.filter((u) => u.id !== user.id));
      if (user.id === meId) qc.setQueryData(meQueryKey, null);
      void qc.invalidateQueries({ queryKey: slotsQueryKey.all });
      break;
    }
    default:
      break;
  }
}

const EVENT_NAMES = [
  "slot.created",
  "slot.updated",
  "slot.deleted",
  "slot.expired",
  "printer.created",
  "printer.updated",
  "printer.deleted",
  "settings.updated",
  "user.updated",
  "user.deleted",
] as const;

/**
 * Keeps one EventSource open while signed in. The browser reconnects by itself on network errors;
 * after a reconnect we refetch the visible data. A non-200 (session gone) closes it for good, and
 * we drop the cached user so the guards send the person to sign in.
 */
export function useEventStream(meId: number | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (meId === undefined) {
      setStatus("closed");
      return;
    }
    let wasConnected = false;
    setStatus("connecting");
    const es = new EventSource("/api/stream");

    es.onopen = () => {
      if (wasConnected) refetchAfterReconnect(qc);
      wasConnected = true;
      setStatus("live");
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setStatus("closed");
        void qc.invalidateQueries({ queryKey: meQueryKey });
      } else {
        setStatus("reconnecting");
      }
    };
    for (const name of EVENT_NAMES) {
      es.addEventListener(name, (ev) => {
        try {
          applyStreamEvent(qc, name, JSON.parse((ev as MessageEvent).data), meId);
        } catch {
          // malformed payload: ignore, the next refetch heals it
        }
      });
    }
    return () => {
      es.close();
      setStatus("closed");
    };
  }, [meId, qc]);
}
