import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

/** Thrown by services/routes; mapped to `{ error: code, ...extra }` with the given status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message ?? code);
    this.name = "HttpError";
  }
}

export const unauthorized = () => new HttpError(401, "unauthorized");
export const forbidden = (code = "forbidden", message?: string) =>
  new HttpError(403, code, message);
export const notFound = (code = "not_found") => new HttpError(404, code);

/**
 * Single error mapping for the API (dev doc §7):
 * Zod → 400 validation with issues, HttpError → its status, Fastify errors keep their status,
 * everything else → 500 without leaking internals.
 */
export function errorHandler(err: unknown, request: FastifyRequest, reply: FastifyReply) {
  {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: "validation",
        issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, ...err.extra });
    }
    const fe = err as FastifyError;
    if (typeof fe?.statusCode === "number" && fe.statusCode >= 400 && fe.statusCode < 500) {
      const code =
        fe.statusCode === 429
          ? "rate_limited"
          : fe.statusCode === 413
            ? "payload_too_large"
            : (fe.code ?? "bad_request").toLowerCase();
      return reply.code(fe.statusCode).send({ error: code, message: fe.message });
    }
    request.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: "internal" });
  }
}
