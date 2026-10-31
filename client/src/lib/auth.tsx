import type { Me, Meta } from "@production-line/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "./api.ts";

export const metaQueryKey = ["meta"] as const;
export const meQueryKey = ["me"] as const;

export function useMeta() {
  return useQuery({ queryKey: metaQueryKey, queryFn: () => api<Meta>("/api/meta") });
}

/** The signed-in user, or null when there is no valid session. */
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async () => {
      try {
        return await api<Me>("/api/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      qc.setQueryData(meQueryKey, null);
      void qc.invalidateQueries({ queryKey: metaQueryKey });
    },
  });
}

/** Detected from the browser; written as the app timezone during first-boot setup. */
export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
