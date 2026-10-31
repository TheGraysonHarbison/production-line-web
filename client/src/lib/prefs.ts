import type { TimeFormat } from "@production-line/shared";
import { useMe, useMeta } from "./auth.tsx";

/** App-wide display timezone (settings) with a UTC fallback before setup records one. */
export function useTimeZone(): string {
  return useMeta().data?.timezone ?? "UTC";
}

export function useTimeFormat(): TimeFormat {
  return useMe().data?.time_format ?? "12h";
}
