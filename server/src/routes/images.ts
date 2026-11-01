import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import "@fastify/multipart";
import { IdSchema, isBrowserRenderable, type Slot } from "@production-line/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { forbidden, HttpError } from "../errors.js";
import { requireAuth, requireSlotAccess } from "../plugins/auth.js";

const SlotImageParams = z.object({
  id: z.coerce.number().pipe(IdSchema),
  imageId: z.coerce.number().pipe(IdSchema),
});
const StoredNameParams = z.object({
  storedName: z.string().regex(/^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/),
});

/** RFC 6266 / 5987 filename parameters, ASCII fallback plus UTF-8. */
function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Reads the single file part of a multipart request, or 400s. */
export async function filePart(request: FastifyRequest) {
  if (!request.isMultipart())
    throw new HttpError(400, "multipart_required", "send multipart/form-data");
  const part = await request.file();
  if (!part) throw new HttpError(400, "no_file", "no file in the request");
  return part;
}

export function assertImagesEnabled(enabled: boolean): void {
  if (!enabled) throw forbidden("images_disabled", "image uploads are not enabled");
}

export const imagesRoutes: FastifyPluginAsync = async (app) => {
  const { images, slots, settings, events } = app.ctx;

  app.post(
    "/slots/:id/images",
    { preHandler: requireSlotAccess() },
    async (request, reply): Promise<Slot> => {
      assertImagesEnabled(settings.getValues().images_enabled);
      const slot = request.slot as Slot;
      const part = await filePart(request);
      const image = await images.store({
        stream: part.file,
        originalName: part.filename,
        uploaderId: (request.user as NonNullable<typeof request.user>).id,
        slotId: slot.id,
      });
      const updated = slots.get(slot.id);
      events.emit("slot.updated", { slot: updated });
      request.log.info(
        {
          by: request.user?.id,
          slot: slot.id,
          image: image.id,
          mime: image.mime,
          bytes: image.bytes,
        },
        "image.uploaded",
      );
      return reply.code(201).send(updated);
    },
  );

  app.delete(
    "/slots/:id/images/:imageId",
    { preHandler: requireSlotAccess() },
    async (request, reply) => {
      const { imageId } = SlotImageParams.parse(request.params);
      const slot = request.slot as Slot;
      const image = images.get(imageId);
      if (!image || image.slot_id !== slot.id) throw new HttpError(404, "image_not_found");
      images.removeRow(image.id);
      await images.unlinkFile(image.stored_name);
      events.emit("slot.updated", { slot: slots.get(slot.id) });
      request.log.info({ by: request.user?.id, slot: slot.id, image: image.id }, "image.deleted");
      return reply.code(204).send();
    },
  );

  // Dedicated serving route (§9.7): session required, nosniff, download for non-browser types.
  app.get("/images/:storedName", { preHandler: requireAuth }, async (request, reply) => {
    const { storedName } = StoredNameParams.parse(request.params);
    const image = images.byStoredName(storedName);
    if (!image) throw new HttpError(404, "image_not_found");
    const path = images.pathOf(storedName);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      throw new HttpError(404, "image_not_found");
    }
    const inline = isBrowserRenderable(image.mime);
    return reply
      .header("x-content-type-options", "nosniff")
      .header("content-type", image.mime)
      .header("content-length", size)
      .header(
        "content-disposition",
        contentDisposition(inline ? "inline" : "attachment", image.original_name),
      )
      .header("cache-control", "private, max-age=31536000, immutable")
      .send(createReadStream(path));
  });
};
