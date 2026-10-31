import { z } from "zod";

/** ISO-8601 UTC timestamp, e.g. "2026-11-02T18:00:00.000Z". All DB/API timestamps use this. */
export const IsoDateTimeSchema = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/** "#RRGGBB" */
export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "must be a hex color like #4f9cff")
  .transform((s) => s.toLowerCase());

export const RoleSchema = z.enum(["owner", "admin", "user"]);
export type Role = z.infer<typeof RoleSchema>;

export const TimeFormatSchema = z.enum(["12h", "24h"]);
export type TimeFormat = z.infer<typeof TimeFormatSchema>;

export const IdSchema = z.number().int().positive();

/** True when `tz` is an IANA zone the runtime knows (e.g. "America/New_York"). */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const TimeZoneSchema = z
  .string()
  .min(1)
  .refine(isValidTimeZone, "must be an IANA time zone name");
