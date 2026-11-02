import { createReadStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../plugins/auth.js";

/** `production-line-YYYYMMDD-HHMM.db` in UTC (dev doc §7). */
export function backupFilename(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `production-line-${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}.db`;
}

/**
 * GET /api/backup (dev doc §16): a consistent copy of the database made with `VACUUM INTO`,
 * streamed to the admin and deleted from disk once sent. Images are not included.
 */
export const backupRoutes: FastifyPluginAsync = async (app) => {
  app.get("/backup", { preHandler: requireRole("admin") }, async (request, reply) => {
    const tmp = join(app.ctx.dataDir.root, `.backup-${process.pid}-${Date.now()}.db`);
    // VACUUM INTO writes a compact, transactionally consistent snapshot even while WAL is active.
    app.ctx.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); // sql: path literal, quoted
    const size = (await stat(tmp)).size;
    const stream = createReadStream(tmp);
    const cleanup = () => void unlink(tmp).catch(() => undefined);
    stream.once("close", cleanup);
    stream.once("error", cleanup);
    request.log.info({ by: request.user?.id, bytes: size }, "backup.downloaded");
    return reply
      .header("content-type", "application/vnd.sqlite3")
      .header("content-length", size)
      .header("content-disposition", `attachment; filename="${backupFilename()}"`)
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .send(stream);
  });
};
