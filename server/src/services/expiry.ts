import type { Logger } from "pino";
import { HttpError } from "../errors.js";
import {
  buildExpiredPayload,
  HA_EXPIRED_EVENT,
  type HaClient,
  type HaDeliveryResult,
} from "./ha.js";
import type { SettingsService } from "./settings.js";
import type { SlotsService } from "./slots.js";

export interface ExpirySchedulerDeps {
  slots: SlotsService;
  settings: SettingsService;
  ha: HaClient;
  log: Logger;
}

export interface ExpirySchedulerOptions {
  /** Dev doc §3.4: 30 s. */
  tickMs?: number;
  now?: () => Date;
}

/**
 * Expiry scheduler (dev doc §3.4): a catch-up pass at boot, then a tick every 30 s. Each pass
 * takes every slot with `end_at <= now` in `end_at` order and, per slot, builds the HA payload,
 * delivers it when HA is enabled, deletes the slot (which emits `slot.expired`), and logs
 * `expiry.processed`. Stopping waits for the slot in flight and leaves the rest for the next
 * boot's catch-up.
 */
export class ExpiryScheduler {
  private readonly tickMs: number;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<number> | null = null;
  private stopped = false;

  constructor(
    private readonly deps: ExpirySchedulerDeps,
    options: ExpirySchedulerOptions = {},
  ) {
    this.tickMs = options.tickMs ?? 30_000;
    this.now = options.now ?? (() => new Date());
  }

  /** Runs the catch-up pass, then starts ticking. Resolves when the catch-up is done. */
  async start(): Promise<void> {
    this.stopped = false;
    await this.run(true);
    if (this.stopped || this.timer) return;
    this.timer = setInterval(() => void this.run(false), this.tickMs);
  }

  /** Stops ticking and waits for an in-flight slot to finish. Idempotent. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.inFlight) await this.inFlight;
  }

  /** One pass. Concurrent calls share the pass already running. Returns slots processed. */
  run(catchUp = false): Promise<number> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.process(catchUp)
      .catch((err: unknown) => {
        this.deps.log.error({ err }, "expiry.failed");
        return 0;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private async process(catchUp: boolean): Promise<number> {
    const { slots, settings, ha, log } = this.deps;
    const expired = slots.listExpired(this.now().toISOString());
    if (catchUp) {
      log.info({ count: expired.length, ids: expired.map((s) => s.id) }, "expiry.catchup");
    }
    let processed = 0;
    for (const slot of expired) {
      if (this.stopped && processed > 0) break;
      const timezone = settings.getValues().timezone ?? "UTC";
      const payload = buildExpiredPayload(slot, timezone, this.now().toISOString(), catchUp);
      let delivery: HaDeliveryResult = {
        status: "skipped",
        httpStatus: null,
        attempts: 0,
        error: null,
      };
      if (ha.isEnabled()) delivery = await ha.fire(HA_EXPIRED_EVENT, payload);
      try {
        slots.delete(slot.id, "expired");
      } catch (err) {
        // Deleted by hand while HA was being notified: nothing left to do.
        if (err instanceof HttpError && err.code === "slot_not_found") {
          log.info({ slotId: slot.id }, "expiry.vanished");
          continue;
        }
        throw err;
      }
      log.info(
        {
          slotId: slot.id,
          ha: delivery.status,
          haStatus: delivery.httpStatus,
          attempts: delivery.attempts,
          catchUp,
        },
        "expiry.processed",
      );
      processed++;
    }
    return processed;
  }
}
