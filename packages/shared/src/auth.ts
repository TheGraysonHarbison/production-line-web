import { z } from "zod";
import { HexColorSchema, IsoDateTimeSchema, TimeFormatSchema, TimeZoneSchema } from "./common.js";
import { PublicUserSchema } from "./entities.js";

/** Dev doc §3.1: 3–32 chars, `[A-Za-z0-9_.-]`, case-insensitive unique. */
export const UsernameSchema = z
  .string()
  .min(3, "must be at least 3 characters")
  .max(32, "must be at most 32 characters")
  .regex(/^[A-Za-z0-9_.-]+$/, "only letters, digits, '_', '.', and '-' are allowed");

/** Dev doc §3.1: 8–128 chars, no other composition rules. */
export const PasswordSchema = z
  .string()
  .min(8, "must be at least 8 characters")
  .max(128, "must be at most 128 characters");

export const RegisterBodySchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  favorite_color: HexColorSchema,
});
export type RegisterBody = z.infer<typeof RegisterBodySchema>;

/** First-boot Owner creation; the browser's detected zone becomes the initial app timezone. */
export const SetupBodySchema = RegisterBodySchema.extend({
  timezone: TimeZoneSchema.optional(),
});
export type SetupBody = z.infer<typeof SetupBodySchema>;

export const LoginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginBody = z.infer<typeof LoginBodySchema>;

/** The caller's own profile + preferences (`GET /api/me`). */
export const MeSchema = PublicUserSchema.extend({
  time_format: TimeFormatSchema,
  created_at: IsoDateTimeSchema,
});
export type Me = z.infer<typeof MeSchema>;

export const UpdateMeBodySchema = z
  .object({
    color: HexColorSchema.optional(),
    time_format: TimeFormatSchema.optional(),
    password: PasswordSchema.optional(),
    current_password: z.string().min(1).optional(),
  })
  .refine((b) => b.password === undefined || b.current_password !== undefined, {
    message: "current_password is required to change the password",
    path: ["current_password"],
  });
export type UpdateMeBody = z.infer<typeof UpdateMeBodySchema>;

export const UpdateRoleBodySchema = z.object({
  role: z.enum(["admin", "user"]),
});
export type UpdateRoleBody = z.infer<typeof UpdateRoleBodySchema>;

export const TransferOwnershipBodySchema = z.object({
  current_password: z.string().min(1),
});
export type TransferOwnershipBody = z.infer<typeof TransferOwnershipBodySchema>;
