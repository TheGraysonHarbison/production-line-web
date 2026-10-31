import type {
  CreatePrinterBody,
  Printer,
  PublicSettings,
  PublicUser,
  Slot,
  UpdatePrinterBody,
  UpdateSettingsBody,
} from "@production-line/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import { metaQueryKey } from "./auth.tsx";

export const printersQueryKey = ["printers"] as const;
export const settingsQueryKey = ["settings"] as const;
export const usersQueryKey = ["users"] as const;
export const slotsQueryKey = {
  all: ["slots"] as const,
  range: (from: string, to: string) => ["slots", from, to] as const,
};

/** Slots overlapping [from, to) as ISO instants. Patched live by the event stream. */
export function useSlotsRange(from: string, to: string) {
  return useQuery({
    queryKey: slotsQueryKey.range(from, to),
    queryFn: () =>
      api<Slot[]>(`/api/slots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  });
}

export function usePrinters() {
  return useQuery({ queryKey: printersQueryKey, queryFn: () => api<Printer[]>("/api/printers") });
}

export function usePrinterMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: printersQueryKey });
  return {
    create: useMutation({
      mutationFn: (body: CreatePrinterBody) =>
        api<Printer>("/api/printers", { method: "POST", body }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: UpdatePrinterBody & { id: number }) =>
        api<Printer>(`/api/printers/${id}`, { method: "PATCH", body }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: number) => api<void>(`/api/printers/${id}`, { method: "DELETE" }),
      onSuccess: refresh,
    }),
  };
}

export function useSettings() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: () => api<PublicSettings>("/api/settings"),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSettingsBody) =>
      api<PublicSettings>("/api/settings", { method: "PATCH", body }),
    // Optimistic: toggles reflect immediately; the server response (or a rollback) follows.
    onMutate: async (body) => {
      const previous = qc.getQueryData<PublicSettings>(settingsQueryKey);
      if (previous) {
        const { ha_token, ...rest } = body;
        qc.setQueryData<PublicSettings>(settingsQueryKey, {
          ...previous,
          ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
          ...(ha_token !== undefined ? { ha_token: { set: ha_token !== null } } : {}),
        });
      }
      await qc.cancelQueries({ queryKey: settingsQueryKey });
      return { previous };
    },
    onError: (_err, _body, context) => {
      if (context?.previous) qc.setQueryData(settingsQueryKey, context.previous);
    },
    onSuccess: (settings) => {
      qc.setQueryData(settingsQueryKey, settings);
      void qc.invalidateQueries({ queryKey: metaQueryKey });
    },
  });
}

export function useUsers() {
  return useQuery({ queryKey: usersQueryKey, queryFn: () => api<PublicUser[]>("/api/users") });
}

export function useUserMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: usersQueryKey });
  return {
    setRole: useMutation({
      mutationFn: ({ id, role }: { id: number; role: "admin" | "user" }) =>
        api<PublicUser>(`/api/users/${id}/role`, { method: "PATCH", body: { role } }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: number) => api<void>(`/api/users/${id}`, { method: "DELETE" }),
      onSuccess: refresh,
    }),
    transfer: useMutation({
      mutationFn: ({ id, current_password }: { id: number; current_password: string }) =>
        api<PublicUser>(`/api/users/${id}/transfer-ownership`, {
          method: "POST",
          body: { current_password },
        }),
      onSuccess: async () => {
        await refresh();
        await qc.invalidateQueries({ queryKey: ["me"] });
      },
    }),
  };
}
