import { type Meta, MetaSchema } from "@production-line/shared";

export async function fetchMeta(): Promise<Meta> {
  const res = await fetch("/api/meta");
  if (!res.ok) {
    throw new Error(`GET /api/meta failed: ${res.status}`);
  }
  return MetaSchema.parse(await res.json());
}
