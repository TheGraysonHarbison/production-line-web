import type { DatabaseSync } from "node:sqlite";
import type { PublicSettings, SettingKey } from "@production-line/shared";
import { withTransaction } from "../db/connection.js";
import type { AppEvents } from "../events.js";
import { decryptSecret, encryptSecret } from "./crypto.js";

/** Plaintext view of every setting. `ha_token` here is the real token; never send this to clients. */
export interface SettingsValues {
  registration_enabled: boolean;
  images_enabled: boolean;
  ha_enabled: boolean;
  ha_base_url: string | null;
  ha_token: string | null;
  timezone: string | null;
}

const DEFAULTS: Pick<SettingsValues, "registration_enabled" | "images_enabled" | "ha_enabled"> = {
  registration_enabled: true,
  images_enabled: false,
  ha_enabled: false,
};

const ENCRYPTED_KEYS: ReadonlySet<SettingKey> = new Set(["ha_token"]);

interface Row {
  key: string;
  value: string;
}

/**
 * Global settings (dev doc §3.5) stored as JSON rows. `ha_token` is AES-256-GCM encrypted with
 * the DATA_DIR secret key before it touches the database (§9.5).
 */
export class SettingsService {
  private readonly selectAll;
  private readonly upsert;
  private readonly remove;

  constructor(
    private readonly db: DatabaseSync,
    private readonly secretKey: Buffer,
    private readonly events: AppEvents,
  ) {
    this.selectAll = db.prepare("SELECT key, value FROM settings");
    this.upsert = db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :updated_at)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    this.remove = db.prepare("DELETE FROM settings WHERE key = :key");
  }

  /** Inserts defaults for keys that have never been set. Safe to call on every boot. */
  seedDefaults(): void {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (:key, :value, :updated_at)",
    );
    withTransaction(this.db, () => {
      for (const [key, value] of Object.entries(DEFAULTS)) {
        insert.run({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() });
      }
    });
  }

  /** Full plaintext values for server-side use only. */
  getValues(): SettingsValues {
    const rows = this.selectAll.all() as unknown as Row[];
    const raw = new Map(rows.map((r) => [r.key, r.value]));
    const read = <T>(key: SettingKey, fallback: T): T => {
      const v = raw.get(key);
      return v === undefined ? fallback : (JSON.parse(v) as T);
    };
    const encToken = read<string | null>("ha_token", null);
    return {
      registration_enabled: read("registration_enabled", DEFAULTS.registration_enabled),
      images_enabled: read("images_enabled", DEFAULTS.images_enabled),
      ha_enabled: read("ha_enabled", DEFAULTS.ha_enabled),
      ha_base_url: read<string | null>("ha_base_url", null),
      ha_token: encToken === null ? null : decryptSecret(this.secretKey, encToken),
      timezone: read<string | null>("timezone", null),
    };
  }

  /** Client-safe view: the token is reduced to `{ set }`. */
  get(): PublicSettings {
    const { ha_token, ...rest } = this.getValues();
    return { ...rest, ha_token: { set: ha_token !== null } };
  }

  /** Decrypted HA token for the HA client only. */
  getHaToken(): string | null {
    return this.getValues().ha_token;
  }

  /**
   * Writes the given keys in one transaction and emits `settings.updated` with the key names.
   * `null` for a nullable key clears it (`ha_token: null` forgets the token).
   */
  update(patch: Partial<SettingsValues>): PublicSettings {
    const keys = Object.keys(patch) as SettingKey[];
    if (keys.length === 0) return this.get();

    const updated_at = new Date().toISOString();
    withTransaction(this.db, () => {
      for (const key of keys) {
        const value = patch[key];
        if (value === undefined) continue;
        if (value === null) {
          this.remove.run({ key });
          continue;
        }
        const stored = ENCRYPTED_KEYS.has(key)
          ? encryptSecret(this.secretKey, String(value))
          : value;
        this.upsert.run({ key, value: JSON.stringify(stored), updated_at });
      }
    });

    this.events.emit("settings.updated", { keys });
    return this.get();
  }
}
