import type { Slot } from "@production-line/shared";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

export interface CreateDefaults {
  start_at?: string;
  end_at?: string;
  printer_ids?: number[];
}

export type EditorRequest =
  | { mode: "create"; defaults: CreateDefaults }
  | { mode: "edit"; slot: Slot };

interface EditorContextValue {
  request: EditorRequest | null;
  openCreate: (defaults?: CreateDefaults) => void;
  openEdit: (slot: Slot) => void;
  close: () => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

/** Lets the dock, calendar, and timeline open the one slot editor. */
export function EditorProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<EditorRequest | null>(null);
  const openCreate = useCallback(
    (defaults: CreateDefaults = {}) => setRequest({ mode: "create", defaults }),
    [],
  );
  const openEdit = useCallback((slot: Slot) => setRequest({ mode: "edit", slot }), []);
  const close = useCallback(() => setRequest(null), []);
  const value = useMemo(
    () => ({ request, openCreate, openEdit, close }),
    [request, openCreate, openEdit, close],
  );
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor outside EditorProvider");
  return ctx;
}
