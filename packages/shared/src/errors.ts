import { z } from "zod";

/** Shape of every non-2xx JSON response from the API (dev doc §7). */
export const ApiErrorBodySchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  issues: z
    .array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }))
    .optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
