import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { UserRow } from "./users.js";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sliding expiry is only written back when at least this much of the window has elapsed. */
const SLIDE_AFTER_MS = 60 * 60 * 1000;

interface JoinedRow extends UserRow {
  session_id: string;
  user_id: number;
  session_created_at: string;
  expires_at: string;
}

export interface SessionRow {
  id: string;
  user_id: number;
  created_at: string;
  expires_at: string;
}

/** Server-side sessions (dev doc §4, §9.1): 256-bit random IDs, 30-day sliding expiry, revocable. */
export class SessionsService {
  private readonly insert;
  private readonly select;
  private readonly touch;
  private readonly remove;
  private readonly removeForUser;
  private readonly removeOthers;
  private readonly purge;

  constructor(db: DatabaseSync) {
    this.insert = db.prepare(
      "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (:id, :user_id, :created_at, :expires_at)",
    );
    this.select = db.prepare(
      `SELECT s.id AS session_id, s.user_id, s.created_at AS session_created_at, s.expires_at,
              u.id, u.username, u.password_hash, u.color, u.role, u.time_format, u.avatar_image_id, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = :id`,
    );
    this.touch = db.prepare("UPDATE sessions SET expires_at = :expires_at WHERE id = :id");
    this.remove = db.prepare("DELETE FROM sessions WHERE id = :id");
    this.removeForUser = db.prepare("DELETE FROM sessions WHERE user_id = :user_id");
    this.removeOthers = db.prepare("DELETE FROM sessions WHERE user_id = :user_id AND id != :keep");
    this.purge = db.prepare("DELETE FROM sessions WHERE expires_at <= :now");
  }

  create(userId: number, now = new Date()): SessionRow {
    const row: SessionRow = {
      id: randomBytes(32).toString("base64url"),
      user_id: userId,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    };
    this.insert.run({ ...row });
    return row;
  }

  /** Returns the session and its user, sliding the expiry forward; null if unknown or expired. */
  resolve(id: string, now = new Date()): { session: SessionRow; user: UserRow } | null {
    const joined = this.select.get({ id }) as unknown as JoinedRow | undefined;
    if (!joined) return null;
    const expiresAt = Date.parse(joined.expires_at);
    if (expiresAt <= now.getTime()) {
      this.remove.run({ id });
      return null;
    }
    let session: SessionRow = {
      id,
      user_id: joined.user_id,
      created_at: joined.session_created_at,
      expires_at: joined.expires_at,
    };
    const idealExpiry = now.getTime() + SESSION_TTL_MS;
    if (idealExpiry - expiresAt >= SLIDE_AFTER_MS) {
      session = { ...session, expires_at: new Date(idealExpiry).toISOString() };
      this.touch.run({ id, expires_at: session.expires_at });
    }
    const user: UserRow = {
      id: joined.id,
      username: joined.username,
      password_hash: joined.password_hash,
      color: joined.color,
      role: joined.role,
      time_format: joined.time_format,
      avatar_image_id: joined.avatar_image_id,
      created_at: joined.created_at,
    };
    return { session, user };
  }

  delete(id: string): void {
    this.remove.run({ id });
  }

  /** Revokes every session of a user (password change, deletion). Optionally keeps one. */
  revokeAll(userId: number, keep?: string): number {
    const result = keep
      ? this.removeOthers.run({ user_id: userId, keep })
      : this.removeForUser.run({ user_id: userId });
    return Number(result.changes);
  }

  purgeExpired(now = new Date()): number {
    return Number(this.purge.run({ now: now.toISOString() }).changes);
  }
}
