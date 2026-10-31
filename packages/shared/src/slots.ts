import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";
import { PublicUserSchema } from "./entities.js";
import { RANGE_QUERY_MAX_MS } from "./time.js";

export const SlotNameSchema = z
  .string()
  .trim()
  .min(1, "name is required")
  .max(80, "must be at most 80 characters");
export const SlotDescriptionSchema = z.string().max(2000, "must be at most 2000 characters");

const PrinterIdsSchema = z
  .array(IdSchema)
  .min(1, "pick at least one printer")
  .transform((ids) => [...new Set(ids)]);

/**
 * POST /api/slots. Times are ISO-8601 UTC instants; the server rounds them to the nearest
 * 5 minutes ("start now" works) and enforces the §3.3 rules.
 */
export const CreateSlotBodySchema = z.object({
  name: SlotNameSchema,
  description: SlotDescriptionSchema.nullable().optional(),
  start_at: IsoDateTimeSchema,
  end_at: IsoDateTimeSchema,
  printer_ids: PrinterIdsSchema,
});
export type CreateSlotBody = z.infer<typeof CreateSlotBodySchema>;

/** PATCH /api/slots/:id. Any subset; times and printers are re-validated against the merged slot. */
export const UpdateSlotBodySchema = z
  .object({
    name: SlotNameSchema.optional(),
    description: SlotDescriptionSchema.nullable().optional(),
    start_at: IsoDateTimeSchema.optional(),
    end_at: IsoDateTimeSchema.optional(),
    printer_ids: PrinterIdsSchema.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "nothing to update" });
export type UpdateSlotBody = z.infer<typeof UpdateSlotBodySchema>;

/** GET /api/slots?from=&to= — slots overlapping [from, to); at most 62 days (dev doc §7). */
export const SlotRangeQuerySchema = z
  .object({ from: IsoDateTimeSchema, to: IsoDateTimeSchema })
  .refine((q) => Date.parse(q.to) > Date.parse(q.from), {
    message: "to must be after from",
    path: ["to"],
  })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= RANGE_QUERY_MAX_MS, {
    message: "range may not exceed 62 days",
    path: ["to"],
  });
export type SlotRangeQuery = z.infer<typeof SlotRangeQuerySchema>;

/** The 409 body for a scheduling conflict (dev doc §7). One entry per printer that is taken. */
export const ConflictResponseSchema = z.object({
  error: z.literal("conflict"),
  message: z.string().optional(),
  printers: z.array(
    z.object({
      id: IdSchema,
      name: z.string(),
      slot: z.object({
        id: IdSchema,
        name: z.string(),
        start_at: IsoDateTimeSchema,
        end_at: IsoDateTimeSchema,
        user: PublicUserSchema,
      }),
    }),
  ),
});
export type ConflictResponse = z.infer<typeof ConflictResponseSchema>;
