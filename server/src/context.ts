import type { DatabaseSync } from "node:sqlite";
import type { Logger } from "pino";
import type { Config } from "./config.js";
import { bootstrapDataDir, type DataDir } from "./data-dir.js";
import { openDatabase } from "./db/connection.js";
import { migrate } from "./db/migrate.js";
import { AppEvents } from "./events.js";
import { PrintersService } from "./services/printers.js";
import { SessionsService } from "./services/sessions.js";
import { SettingsService } from "./services/settings.js";
import { UsersService } from "./services/users.js";

/** Everything the routes and services need, built once at startup. */
export interface AppContext {
  config: Config;
  dataDir: DataDir;
  db: DatabaseSync;
  events: AppEvents;
  settings: SettingsService;
  users: UsersService;
  sessions: SessionsService;
  printers: PrintersService;
  log: Logger;
}

/**
 * Boot sequence: data dir → secret key → database → migrations → defaults.
 * Fails fast on any problem so a broken install never serves requests.
 */
export function createContext(config: Config, log: Logger): AppContext {
  const dataDir = bootstrapDataDir(config.dataDir);
  for (const w of bootstrapDataDir.warnings.splice(0)) {
    log.warn({ dataDir: dataDir.root }, w);
  }

  const db = openDatabase(dataDir.dbPath);
  const migration = migrate(db);
  if (migration.applied.length > 0) {
    log.info({ applied: migration.applied, version: migration.current }, "db.migrated");
  } else {
    log.debug({ version: migration.current }, "db.up_to_date");
  }

  const events = new AppEvents();
  const settings = new SettingsService(db, dataDir.secretKey, events);
  settings.seedDefaults();

  const users = new UsersService(db, events);
  const sessions = new SessionsService(db);
  const printers = new PrintersService(db, events);
  const purged = sessions.purgeExpired();
  if (purged > 0) log.info({ purged }, "sessions.purged");

  return { config, dataDir, db, events, settings, users, sessions, printers, log };
}

export function closeContext(ctx: AppContext): void {
  ctx.db.close();
}
