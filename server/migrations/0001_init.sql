-- Production Line Web — initial schema (dev doc §6).
-- `schema_migrations` is owned by the migration runner and created before this file runs.
-- All timestamps are ISO-8601 UTC strings.

CREATE TABLE users (
  id              INTEGER PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,                 -- "scrypt$N$r$p$salt$hash" (base64)
  color           TEXT NOT NULL,                 -- "#rrggbb"
  role            TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'user')),
  time_format     TEXT NOT NULL DEFAULT '12h' CHECK (time_format IN ('12h', '24h')),
  avatar_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL
);

-- Exactly one owner.
CREATE UNIQUE INDEX users_single_owner ON users(role) WHERE role = 'owner';

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,                   -- 32 random bytes, base64url
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL                       -- created + 30 days, sliding
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);

CREATE TABLE printers (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  invisible  INTEGER NOT NULL DEFAULT 0 CHECK (invisible IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE slots (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  start_at    TEXT NOT NULL,                     -- ISO-8601 UTC, 5-minute aligned
  end_at      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK (end_at > start_at)
);
CREATE INDEX slots_range ON slots(start_at, end_at);
CREATE INDEX slots_user ON slots(user_id);

CREATE TABLE slot_printers (
  slot_id    INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  printer_id INTEGER NOT NULL REFERENCES printers(id) ON DELETE RESTRICT,
  PRIMARY KEY (slot_id, printer_id)
);
CREATE INDEX slot_printers_printer ON slot_printers(printer_id);

CREATE TABLE images (
  id            INTEGER PRIMARY KEY,
  slot_id       INTEGER REFERENCES slots(id) ON DELETE CASCADE,   -- NULL for avatars
  uploader_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stored_name   TEXT NOT NULL UNIQUE,            -- "<uuid>.<ext>" under DATA_DIR/images
  original_name TEXT NOT NULL,
  mime          TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX images_slot ON images(slot_id);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                      -- JSON; ha_token stored as AES-GCM ciphertext
  updated_at TEXT NOT NULL
);
