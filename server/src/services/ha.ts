import type { Slot } from "@production-line/shared";
import type { Logger } from "pino";
import { Temporal } from "temporal-polyfill";
import { HttpError } from "../errors.js";
import type { SettingsService } from "./settings.js";

/** Event types fired at Home Assistant (dev doc §8). Phase 14 adds `production_line_slot_started`. */
export const HA_EXPIRED_EVENT = "production_line_slot_expired";
export const HA_TEST_EVENT = "production_line_test";

/** Dev doc §8 payload, built once per expiry. Local times come from the app timezone. */
export interface ExpiredPayload {
  slot: {
    id: number;
    name: string;
    description: string | null;
    start_at: string;
    end_at: string;
    start_local: string;
    end_local: string;
    timezone: string;
  };
  user: { id: number; username: string; color: string };
  printers: { id: number; name: string }[];
  expired_at: string;
  catch_up: boolean;
}

/** "2026-11-02T18:00:00Z": seconds precision, as in §8 (Temporal trims zero fractions). */
function instant(iso: string): Temporal.Instant {
  return Temporal.Instant.from(iso).round({ smallestUnit: "second", roundingMode: "floor" });
}

/**
 * Builds the §8 payload. This is the only timezone math on the server: `start_local`/`end_local`
 * are the slot's wall-clock times in the app timezone with their UTC offset.
 */
export function buildExpiredPayload(
  slot: Slot,
  timezone: string,
  expiredAtIso: string,
  catchUp: boolean,
): ExpiredPayload {
  const local = (iso: string) =>
    instant(iso).toZonedDateTimeISO(timezone).toString({ timeZoneName: "never" });
  return {
    slot: {
      id: slot.id,
      name: slot.name,
      description: slot.description,
      start_at: instant(slot.start_at).toString(),
      end_at: instant(slot.end_at).toString(),
      start_local: local(slot.start_at),
      end_local: local(slot.end_at),
      timezone,
    },
    user: { id: slot.user.id, username: slot.user.username, color: slot.user.color },
    printers: slot.printers.map((p) => ({ id: p.id, name: p.name })),
    expired_at: instant(expiredAtIso).toString(),
    catch_up: catchUp,
  };
}

export type HaDeliveryStatus = "sent" | "failed" | "skipped";

export interface HaDeliveryResult {
  status: HaDeliveryStatus;
  /** Last HTTP status seen, or null when every attempt failed before a response. */
  httpStatus: number | null;
  attempts: number;
  error: string | null;
}

export interface HaClientOptions {
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Waits before attempts 2 and 3 (dev doc §3.4: 2 s, 8 s). */
  backoffMs?: readonly number[];
  requestTimeoutMs?: number;
}

const DEFAULT_BACKOFF_MS = [2_000, 8_000] as const;

/**
 * Home Assistant REST client (dev doc §8): fires native events with the admin's long-lived token.
 * Reads the settings on every call, so toggling HA takes effect without a restart.
 */
export class HaClient {
  private readonly fetchImpl: typeof fetch;
  private readonly backoffMs: readonly number[];
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly settings: SettingsService,
    private readonly log: Logger,
    options: HaClientOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  }

  /** Delivery is on only when the toggle is on and both URL and token exist. */
  isEnabled(): boolean {
    const v = this.settings.getValues();
    return v.ha_enabled && v.ha_base_url !== null && v.ha_token !== null;
  }

  /**
   * Fires `eventType` with `payload`, retrying up to three times with backoff. Never throws: a
   * final failure is logged as `ha.delivery_failed` with the full payload for manual replay.
   */
  async fire(eventType: string, payload: unknown): Promise<HaDeliveryResult> {
    const target = this.target(eventType);
    if (!target) return { status: "skipped", httpStatus: null, attempts: 0, error: null };
    let last: { httpStatus: number | null; error: string | null } = {
      httpStatus: null,
      error: null,
    };
    const maxAttempts = this.backoffMs.length + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      last = await this.post(target.url, target.token, payload);
      if (last.httpStatus !== null && last.httpStatus >= 200 && last.httpStatus < 300) {
        return { status: "sent", httpStatus: last.httpStatus, attempts: attempt, error: null };
      }
      this.log.debug(
        { eventType, attempt, httpStatus: last.httpStatus, error: last.error },
        "ha.attempt_failed",
      );
      const wait = this.backoffMs[attempt - 1];
      if (wait !== undefined) await sleep(wait);
    }
    this.log.warn(
      { eventType, httpStatus: last.httpStatus, error: last.error, attempts: maxAttempts, payload },
      "ha.delivery_failed",
    );
    return {
      status: "failed",
      httpStatus: last.httpStatus,
      attempts: maxAttempts,
      error: last.error,
    };
  }

  /** One attempt at `production_line_test` for the settings page. Throws when not configured. */
  async test(): Promise<HaDeliveryResult> {
    const target = this.target(HA_TEST_EVENT);
    if (!target) {
      throw new HttpError(
        400,
        "ha_not_configured",
        "set the Home Assistant base URL and token first",
      );
    }
    const r = await this.post(target.url, target.token, {
      source: "production-line-web",
      fired_at: instant(new Date().toISOString()).toString(),
    });
    const ok = r.httpStatus !== null && r.httpStatus >= 200 && r.httpStatus < 300;
    return {
      status: ok ? "sent" : "failed",
      httpStatus: r.httpStatus,
      attempts: 1,
      error: r.error,
    };
  }

  /** URL + decrypted token, or null when either is missing (regardless of the toggle). */
  private target(eventType: string): { url: string; token: string } | null {
    const base = this.settings.getValues().ha_base_url;
    const token = this.settings.getHaToken();
    if (!base || !token) return null;
    return { url: `${base.replace(/\/+$/, "")}/api/events/${eventType}`, token };
  }

  private async post(
    url: string,
    token: string,
    payload: unknown,
  ): Promise<{ httpStatus: number | null; error: string | null }> {
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      // Drain so the connection can be reused; the body isn't interesting.
      await res.text().catch(() => undefined);
      return { httpStatus: res.status, error: res.ok ? null : `HTTP ${res.status}` };
    } catch (err) {
      return { httpStatus: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
