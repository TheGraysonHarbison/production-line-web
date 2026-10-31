import { EventEmitter } from "node:events";
import type { Printer, PublicUser, SettingKey, Slot } from "@production-line/shared";

/** Real-time event catalogue (dev doc §5.1). Payloads never include secrets. */
export interface AppEventMap {
  "slot.created": { slot: Slot };
  "slot.updated": { slot: Slot };
  "slot.deleted": { slot: Slot };
  "slot.expired": { slot: Slot };
  "printer.created": { printer: Printer };
  "printer.updated": { printer: Printer };
  "printer.deleted": { printer: Printer };
  "settings.updated": { keys: SettingKey[] };
  "user.updated": { user: PublicUser };
  "user.deleted": { user: PublicUser };
}

export type AppEventName = keyof AppEventMap;

export type AnyListener = <K extends AppEventName>(name: K, payload: AppEventMap[K]) => void;

const ANY = Symbol("any");

/**
 * Typed in-process event bus. Mutations emit here after commit; the SSE broadcaster (Phase 5)
 * and the expiry scheduler (Phase 8) subscribe.
 */
export class AppEvents {
  private readonly emitter = new EventEmitter();

  emit<K extends AppEventName>(name: K, payload: AppEventMap[K]): void {
    this.emitter.emit(name, payload);
    this.emitter.emit(ANY, name, payload);
  }

  /** Subscribes to one event. Returns an unsubscribe function. */
  on<K extends AppEventName>(name: K, listener: (payload: AppEventMap[K]) => void): () => void {
    this.emitter.on(name, listener);
    return () => this.emitter.off(name, listener);
  }

  /** Subscribes to every event (for broadcasters). Returns an unsubscribe function. */
  onAny(listener: AnyListener): () => void {
    this.emitter.on(ANY, listener);
    return () => this.emitter.off(ANY, listener);
  }

  listenerCount(name: AppEventName): number {
    return this.emitter.listenerCount(name);
  }
}
