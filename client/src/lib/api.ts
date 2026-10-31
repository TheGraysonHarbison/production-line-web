import type { ApiErrorBody } from "@production-line/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message ?? body.error);
    this.name = "ApiError";
  }

  get code(): string {
    return this.body.error;
  }

  /** First validation message for a field, if the server returned one. */
  fieldMessage(field: string): string | undefined {
    return this.body.issues?.find((i) => i.path[0] === field)?.message;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

/** JSON fetch wrapper. Same-origin cookies travel automatically; errors become ApiError. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const init: RequestInit = { method: options.method ?? "GET", credentials: "same-origin" };
  if (options.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(options.body);
  }
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const body = (json as ApiErrorBody | null) ?? { error: `http_${res.status}` };
    throw new ApiError(res.status, body);
  }
  return json as T;
}
