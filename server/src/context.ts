import type { DatabaseSync } from "node:sqlite";
import type { Logger } from "pino";
import type { Config } from "./config.js";
import { bootstrapDataDir, type DataDir } from "./data-dir.js";
import { closeDatabase, openDatabase } from "./db/connection.js";
import { migrate } from "./db/migrate.js";
import { AppEvents } from "./events.js";
import { Broadcaster } from "./services/broadcaster.js";
import { ExpiryScheduler } from "./services/expiry.js";
import { HaClient } from "./services/ha.js";
import { ImagesService } from "./services/images.js";
import { PrintersService } from "./services/printers.js";
import { SessionsService } from "./services/sessions.js";
import { SettingsService } from "./services/settings.js";
import { SlotsService } from "./services/slots.js";
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
  slots: SlotsService;
  images: ImagesService;
  broadcaster: Broadcaster;
  ha: HaClient;
  /** Started by `index.ts` after the app is built; tests drive it by hand. */
  expiry: ExpiryScheduler;
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

  const printers = new PrintersService(db, events);
  const slots = new SlotsService(db, events);
  const users = new UsersService(db, events, slots);
  const images = new ImagesService(db, dataDir.imagesDir, log);
  // Image files follow their rows on every deletion path (§3.8): manual, expiry, user cascade.
  slots.onDelete((slot) => void images.removeFiles(slot.images));
  users.onDelete(({ images: rows }) => void images.removeFiles(rows));
  const sessions = new SessionsService(db);
  const purged = sessions.purgeExpired();
  if (purged > 0) log.info({ purged }, "sessions.purged");

  // Live streams die with their sessions (§9.1): logout, password change, user deletion.
  const broadcaster = new Broadcaster(
    events,
    config.streamHeartbeatMs !== undefined ? { heartbeatMs: config.streamHeartbeatMs } : {},
  );
  sessions.onRevoke(({ sessionId, userId, keepSessionId }) => {
    if (sessionId !== undefined) broadcaster.closeForSession(sessionId);
    if (userId !== undefined) broadcaster.closeForUser(userId, keepSessionId);
  });
  events.on("user.deleted", ({ user }) => broadcaster.closeForUser(user.id));

  const ha = new HaClient(settings, log);
  const expiry = new ExpiryScheduler({ slots, settings, ha, log });

  return {
    config,
    dataDir,
    db,
    events,
    settings,
    users,
    sessions,
    printers,
    slots,
    images,
    broadcaster,
    ha,
    expiry,
    log,
  };
}

/** Synchronous teardown for tests; the app's onClose hook does the awaited version. */
export function closeContext(ctx: AppContext): void {
  void ctx.expiry.stop();
  ctx.broadcaster.stop();
  closeDatabase(ctx.db);
}
