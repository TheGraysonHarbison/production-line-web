import {
  CreateSlotBodySchema,
  IdSchema,
  type Slot,
  SlotRangeQuerySchema,
  UpdateSlotBodySchema,
} from "@production-line/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const SlotParamsSchema = z.object({ id: z.coerce.number().pipe(IdSchema) });
function slotParams(params: unknown): { id: number } {
  return SlotParamsSchema.parse(params);
}

import { requireAuth, requireSlotAccess } from "../plugins/auth.js";

export const slotsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/slots", { preHandler: requireAuth }, async (request): Promise<Slot[]> => {
    const { from, to } = SlotRangeQuerySchema.parse(request.query);
    return app.ctx.slots.listRange(from, to);
  });

  app.get("/slots/:id", { preHandler: requireAuth }, async (request): Promise<Slot> => {
    const { id } = slotParams(request.params);
    return app.ctx.slots.get(id);
  });

  app.post("/slots", { preHandler: requireAuth }, async (request, reply): Promise<Slot> => {
    const user = request.user as NonNullable<typeof request.user>;
    const body = CreateSlotBodySchema.parse(request.body);
    const slot = app.ctx.slots.create(user, body);
    request.log.info(
      { by: user.id, slot: slot.id, printers: slot.printers.map((p) => p.id) },
      "slot.created",
    );
    return reply.code(201).send(slot);
  });

  app.patch("/slots/:id", { preHandler: requireSlotAccess() }, async (request): Promise<Slot> => {
    const body = UpdateSlotBodySchema.parse(request.body);
    const slot = app.ctx.slots.update((request.slot as Slot).id, body);
    request.log.info({ by: request.user?.id, slot: slot.id }, "slot.updated");
    return slot;
  });

  app.delete("/slots/:id", { preHandler: requireSlotAccess() }, async (request, reply) => {
    const slot = app.ctx.slots.delete((request.slot as Slot).id, "manual");
    request.log.info({ by: request.user?.id, slot: slot.id }, "slot.deleted");
    return reply.code(204).send();
  });
};
