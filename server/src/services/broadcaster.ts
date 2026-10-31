import type { ServerResponse } from "node:http";
import type { PublicUser, SettingKey } from "@production-line/shared";
import type { AppEventMap, AppEventName, AppEvents } from "../events.js";

export interface StreamClient {
  id: number;
  userId: number;
  sessionId: string;
  res: ServerResponse;
}

export interface BroadcasterOptions {
  /** Comment heartbeat interval; keeps proxies and browsers from timing the stream out. */
  heartbeatMs?: number;
  /** Suggested client reconnect delay, sent as the SSE `retry:` field. */
  retryMs?: number;
}

const PUBLIC_USER_FIELDS = ["id", "username", "color", "role", "avatar_url"] as const;

/**
 * Server-Sent Events fan-out (dev doc §5, §5.1). Every bus event is written to every connected,
 * authenticated client. Payloads are re-shaped here so secrets can never leak even if an emitter
 * is careless: `settings.updated` carries key names only and `user.*` carries public fields only.
 */
export class Broadcaster {
  private readonly clients = new Map<number, StreamClient>();
  private nextClientId = 1;
  private nextEventId = 1;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly unsubscribe: () => void;
  private readonly retryMs: number;

  constructor(events: AppEvents, options: BroadcasterOptions = {}) {
    this.retryMs = options.retryMs ?? 3000;
    const heartbeatMs = options.heartbeatMs ?? 15_000;
    this.unsubscribe = events.onAny((name, payload) => this.broadcast(name, payload));
    this.heartbeat = setInterval(() => this.writeAll(": ping\n\n"), heartbeatMs);
    this.heartbeat.unref();
  }

  get size(): number {
    return this.clients.size;
  }

  /** Registers an open response. Writes the retry hint and a hello comment immediately. */
  add(res: ServerResponse, userId: number, sessionId: string): StreamClient {
    const client: StreamClient = { id: this.nextClientId++, userId, sessionId, res };
    this.clients.set(client.id, client);
    res.write(`retry: ${this.retryMs}\n: connected\n\n`);
    return client;
  }

  remove(client: StreamClient): void {
    this.clients.delete(client.id);
  }

  /** Ends every stream of a user (user deleted, password changed) except an optional session. */
  closeForUser(userId: number, keepSessionId?: string): number {
    let n = 0;
    for (const c of [...this.clients.values()]) {
      if (c.userId === userId && c.sessionId !== keepSessionId) {
        this.end(c);
        n++;
      }
    }
    return n;
  }

  /** Ends the stream(s) bound to one session (logout). */
  closeForSession(sessionId: string): number {
    let n = 0;
    for (const c of [...this.clients.values()]) {
      if (c.sessionId === sessionId) {
        this.end(c);
        n++;
      }
    }
    return n;
  }

  broadcast<K extends AppEventName>(name: K, payload: AppEventMap[K]): void {
    const data = JSON.stringify(sanitize(name, payload));
    this.writeAll(`id: ${this.nextEventId++}\nevent: ${name}\ndata: ${data}\n\n`);
  }

  stop(): void {
    this.unsubscribe();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const c of [...this.clients.values()]) this.end(c);
  }

  private end(client: StreamClient): void {
    this.clients.delete(client.id);
    try {
      client.res.end();
    } catch {
      // already gone
    }
  }

  private writeAll(chunk: string): void {
    for (const c of [...this.clients.values()]) {
      if (c.res.destroyed || c.res.writableEnded) {
        this.clients.delete(c.id);
        continue;
      }
      c.res.write(chunk);
    }
  }
}

/** Defensive re-shaping of outgoing payloads (dev doc §5.1: "no secret values", "public fields"). */
export function sanitize<K extends AppEventName>(name: K, payload: AppEventMap[K]): unknown {
  if (name === "settings.updated") {
    return { keys: [...(payload as { keys: SettingKey[] }).keys] };
  }
  if (name === "user.updated" || name === "user.deleted") {
    const user = (payload as { user: PublicUser }).user;
    return { user: Object.fromEntries(PUBLIC_USER_FIELDS.map((k) => [k, user[k]])) };
  }
  return payload;
}
