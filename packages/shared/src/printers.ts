import { z } from "zod";

/** Dev doc §3.2: 1–64 chars, unique case-insensitively. */
export const PrinterNameSchema = z
  .string()
  .trim()
  .min(1, "name is required")
  .max(64, "must be at most 64 characters");

export const CreatePrinterBodySchema = z.object({
  name: PrinterNameSchema,
  invisible: z.boolean().optional(),
});
export type CreatePrinterBody = z.infer<typeof CreatePrinterBodySchema>;

export const UpdatePrinterBodySchema = z
  .object({
    name: PrinterNameSchema.optional(),
    invisible: z.boolean().optional(),
  })
  .refine((b) => b.name !== undefined || b.invisible !== undefined, {
    message: "nothing to update",
  });
export type UpdatePrinterBody = z.infer<typeof UpdatePrinterBodySchema>;
