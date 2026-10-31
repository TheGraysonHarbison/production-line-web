import { z } from "zod";
import { HexColorSchema, IdSchema, IsoDateTimeSchema, RoleSchema } from "./common.js";

/** Public user fields (dev doc §7 `GET /api/users`). Never includes password hash or preferences. */
export const PublicUserSchema = z.object({
  id: IdSchema,
  username: z.string(),
  color: HexColorSchema,
  role: RoleSchema,
  avatar_url: z.string().nullable(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const PrinterSchema = z.object({
  id: IdSchema,
  name: z.string(),
  invisible: z.boolean(),
  created_at: IsoDateTimeSchema,
});
export type Printer = z.infer<typeof PrinterSchema>;

export const ImageSchema = z.object({
  id: IdSchema,
  slot_id: IdSchema.nullable(),
  uploader_id: IdSchema,
  stored_name: z.string(),
  original_name: z.string(),
  mime: z.string(),
  bytes: z.number().int().nonnegative(),
  created_at: IsoDateTimeSchema,
});
export type Image = z.infer<typeof ImageSchema>;

/** A slot as returned by the API: one row plus its embedded user, printers, and images. */
export const SlotSchema = z.object({
  id: IdSchema,
  user: PublicUserSchema,
  name: z.string(),
  description: z.string().nullable(),
  start_at: IsoDateTimeSchema,
  end_at: IsoDateTimeSchema,
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
  printers: z.array(PrinterSchema),
  images: z.array(ImageSchema),
});
export type Slot = z.infer<typeof SlotSchema>;
