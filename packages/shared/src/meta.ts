import { z } from "zod";

/**
 * Response shape of `GET /api/meta`.
 * Public (unauthenticated) metadata the client needs before it can render anything.
 */
export const MetaSchema = z.object({
  setup_required: z.boolean(),
  registration_enabled: z.boolean(),
  images_enabled: z.boolean(),
  timezone: z.string().min(1),
});

export type Meta = z.infer<typeof MetaSchema>;
