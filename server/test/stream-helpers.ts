import { expect } from "vitest";
import { buildApp } from "../src/app.js";
import type { TestApp } from "./helpers.js";
import { createTestContext, type TestContext } from "./helpers.js";

export interface SseEvent {
  id?: string;
  event?: string;
  data?: string;
  comment?: string;
}

export interface LiveApp extends TestApp {
  baseUrl: string;
}

/** A real listening server (SSE needs a socket; inject() can't stream a hijacked reply). */
export async function createLiveApp(): Promise<LiveApp> {
  const tc: TestContext = createTestContext({ streamHeartbeatMs: 200 });
  const app = await buildApp({ ctx: tc.ctx, publicDir: "/nonexistent" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  return {
    ...tc,
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    cleanup: async () => {
      await app.close();
      tc.cleanup();
    },
  } as LiveApp;
}

export interface OpenStream {
  status: number;
  /** Resolves with the next parsed event (comments included), or rejects on timeout/close. */
  next: (timeoutMs?: number) => Promise<SseEvent>;
  /** Collects events until `count` non-comment events arrive. */
  take: (count: number, timeoutMs?: number) => Promise<SseEvent[]>;
  closed: Promise<void>;
  close: () => void;
}

export async function openStream(live: LiveApp, cookie?: string): Promise<OpenStream> {
  const ac = new AbortController();
  const res = await fetch(`${live.baseUrl}/api/stream`, {
    headers: cookie ? { cookie } : {},
    signal: ac.signal,
  });
  const queue: SseEvent[] = [];
  const waiters: ((e: SseEvent | null) => void)[] = [];
  let done = false;
  const push = (e: SseEvent | null) => {
    if (e === null) {
      done = true;
      for (const w of waiters.splice(0)) w(null);
      return;
    }
    const w = waiters.shift();
    if (w) w(e);
    else queue.push(e);
  };

  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => {
    resolveClosed = r;
  });

  if (res.ok && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    void (async () => {
      try {
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          buffer += decoder.decode(value, { stream: true });
          let idx = buffer.indexOf("\n\n");
          while (idx >= 0) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            push(parseBlock(block));
            idx = buffer.indexOf("\n\n");
          }
        }
      } catch {
        // aborted
      }
      push(null);
      resolveClosed();
    })();
  } else {
    done = true;
    resolveClosed();
  }

  const next = (timeoutMs = 2000) =>
    new Promise<SseEvent>((resolve, reject) => {
      const queued = queue.shift();
      if (queued) return resolve(queued);
      if (done) return reject(new Error("stream closed"));
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for SSE event")),
        timeoutMs,
      );
      waiters.push((e) => {
        clearTimeout(timer);
        if (e === null) reject(new Error("stream closed"));
        else resolve(e);
      });
    });

  const take = async (count: number, timeoutMs = 2000) => {
    const out: SseEvent[] = [];
    while (out.length < count) {
      const e = await next(timeoutMs);
      if (e.event) out.push(e);
    }
    return out;
  };

  return { status: res.status, next, take, closed, close: () => ac.abort() };
}

function parseBlock(block: string): SseEvent {
  const ev: SseEvent = {};
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) {
      ev.comment = (ev.comment ?? "") + line.slice(1).trim();
    } else if (line.startsWith("event:")) ev.event = line.slice(6).trim();
    else if (line.startsWith("data:")) ev.data = (ev.data ?? "") + line.slice(5).trim();
    else if (line.startsWith("id:")) ev.id = line.slice(3).trim();
  }
  return ev;
}

export function expectEvent(e: SseEvent, name: string): unknown {
  expect(e.event).toBe(name);
  expect(e.id).toMatch(/^\d+$/);
  return JSON.parse(e.data ?? "null");
}
