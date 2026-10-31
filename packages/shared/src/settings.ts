import { z } from "zod";
import { TimeZoneSchema } from "./common.js";

/** Global settings keys (dev doc §3.5). */
export const SETTING_KEYS = [
  "registration_enabled",
  "images_enabled",
  "ha_enabled",
  "ha_base_url",
  "ha_token",
  "timezone",
] as const;

export const SettingKeySchema = z.enum(SETTING_KEYS);
export type SettingKey = z.infer<typeof SettingKeySchema>;

/**
 * Settings as exposed to Admin clients (`GET /api/settings`).
 * `ha_token` is write-only: clients only learn whether it is set.
 * `timezone` is null until first-boot setup writes it.
 */
export const PublicSettingsSchema = z.object({
  registration_enabled: z.boolean(),
  images_enabled: z.boolean(),
  ha_enabled: z.boolean(),
  ha_base_url: z.string().nullable(),
  ha_token: z.object({ set: z.boolean() }),
  timezone: z.string().nullable(),
});
export type PublicSettings = z.infer<typeof PublicSettingsSchema>;

/** `PATCH /api/settings` body: any subset of keys. `null` clears `ha_base_url` / `ha_token`. */
export const UpdateSettingsBodySchema = z
  .object({
    registration_enabled: z.boolean().optional(),
    images_enabled: z.boolean().optional(),
    ha_enabled: z.boolean().optional(),
    ha_base_url: z
      .url({ protocol: /^https?$/, hostname: z.regexes.hostname })
      .nullable()
      .optional(),
    ha_token: z.string().min(1).nullable().optional(),
    timezone: TimeZoneSchema.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "nothing to update" });
export type UpdateSettingsBody = z.infer<typeof UpdateSettingsBodySchema>;
