import {
  CreatePrinterBodySchema,
  IdSchema,
  type Printer,
  UpdatePrinterBodySchema,
} from "@production-line/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../plugins/auth.js";

const ParamsSchema = z.object({ id: z.coerce.number().pipe(IdSchema) });

export const printersRoutes: FastifyPluginAsync = async (app) => {
  // Everyone signed in sees every printer, including invisible ones (clients hide them from pickers).
  app.get(
    "/printers",
    { preHandler: requireAuth },
    async (): Promise<Printer[]> => app.ctx.printers.list(),
  );

  app.post(
    "/printers",
    { preHandler: requireRole("admin") },
    async (request, reply): Promise<Printer> => {
      const body = CreatePrinterBodySchema.parse(request.body);
      const printer = app.ctx.printers.create(body);
      request.log.info({ by: request.user?.id, printer: printer.id }, "printer.created");
      return reply.code(201).send(printer);
    },
  );

  app.patch(
    "/printers/:id",
    { preHandler: requireRole("admin") },
    async (request): Promise<Printer> => {
      const { id } = ParamsSchema.parse(request.params);
      const body = UpdatePrinterBodySchema.parse(request.body);
      return app.ctx.printers.update(id, body);
    },
  );

  app.delete("/printers/:id", { preHandler: requireRole("admin") }, async (request, reply) => {
    const { id } = ParamsSchema.parse(request.params);
    const printer = app.ctx.printers.delete(id);
    request.log.info(
      { by: request.user?.id, printer: printer.id, name: printer.name },
      "printer.deleted",
    );
    return reply.code(204).send();
  });
};
