import type { DatabaseSync } from "node:sqlite";
import {
  type Image,
  imageUrl,
  type Me,
  type PublicUser,
  type Role,
  type TimeFormat,
} from "@production-line/shared";
import { withTransaction } from "../db/connection.js";
import { HttpError } from "../errors.js";
import type { AppEvents } from "../events.js";
import type { SlotsService } from "./slots.js";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  color: string;
  role: Role;
  time_format: TimeFormat;
  avatar_image_id: number | null;
  /** From the LEFT JOIN on images; null when there is no avatar. */
  avatar_stored_name: string | null;
  created_at: string;
}

/** Every user read goes through this join so `avatar_url` can be derived without a lookup. */
export const USER_SELECT =
  "SELECT u.*, i.stored_name AS avatar_stored_name FROM users u LEFT JOIN images i ON i.id = u.avatar_image_id";

export interface CreateUserInput {
  username: string;
  password_hash: string;
  color: string;
  role: Role;
}

export interface UpdateUserInput {
  color?: string;
  time_format?: TimeFormat;
  password_hash?: string;
}

export interface DeleteUserResult {
  user: PublicUser;
  cascaded: { sessions: number; slots: number; images: number };
}

const ROLE_RANK: Record<Role, number> = { user: 0, admin: 1, owner: 2 };

/** True when `have` is at least as privileged as `need`. */
export function roleSatisfies(have: Role, need: Role): boolean {
  return ROLE_RANK[have] >= ROLE_RANK[need];
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    color: row.color,
    role: row.role,
    avatar_url: row.avatar_stored_name ? imageUrl(row.avatar_stored_name) : null,
  };
}

export function toMe(row: UserRow): Me {
  return { ...toPublicUser(row), time_format: row.time_format, created_at: row.created_at };
}

/** Users and roles (dev doc §3.1). Owner invariants are enforced here and by the DB index. */
export class UsersService {
  private readonly byId;
  private readonly byUsername;
  private readonly countStmt;
  private readonly listStmt;
  private readonly insert;
  private readonly setRoleStmt;
  private readonly deleteStmt;
  private readonly setAvatarStmt;
  private readonly onDeleteHooks: ((payload: { user: PublicUser; images: Image[] }) => void)[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly events: AppEvents,
    private readonly slots: SlotsService,
  ) {
    this.byId = db.prepare(`${USER_SELECT} WHERE u.id = :id`);
    this.byUsername = db.prepare(`${USER_SELECT} WHERE u.username = :username COLLATE NOCASE`);
    this.countStmt = db.prepare("SELECT COUNT(*) AS n FROM users");
    this.listStmt = db.prepare(`${USER_SELECT} ORDER BY u.username COLLATE NOCASE`);
    this.insert = db.prepare(
      `INSERT INTO users (username, password_hash, color, role, created_at)
       VALUES (:username, :password_hash, :color, :role, :created_at)`,
    );
    this.setRoleStmt = db.prepare("UPDATE users SET role = :role WHERE id = :id");
    this.deleteStmt = db.prepare("DELETE FROM users WHERE id = :id");
    this.setAvatarStmt = db.prepare("UPDATE users SET avatar_image_id = :image_id WHERE id = :id");
  }

  count(): number {
    return (this.countStmt.get() as { n: number }).n;
  }

  findById(id: number): UserRow | null {
    return (this.byId.get({ id }) as UserRow | undefined) ?? null;
  }

  findByUsername(username: string): UserRow | null {
    return (this.byUsername.get({ username }) as UserRow | undefined) ?? null;
  }

  list(): PublicUser[] {
    return (this.listStmt.all() as unknown as UserRow[]).map(toPublicUser);
  }

  /** Throws 409 `username_taken` on a case-insensitive collision. */
  create(input: CreateUserInput): UserRow {
    try {
      const result = this.insert.run({ ...input, created_at: new Date().toISOString() });
      return this.findById(Number(result.lastInsertRowid)) as UserRow;
    } catch (err) {
      if (/UNIQUE constraint failed: users\.username/.test((err as Error).message)) {
        throw new HttpError(409, "username_taken", "that username is already taken");
      }
      throw err;
    }
  }

  update(id: number, patch: UpdateUserInput): UserRow {
    const sets: string[] = [];
    const params: Record<string, string | number> = { id };
    for (const key of ["color", "time_format", "password_hash"] as const) {
      const value = patch[key];
      if (value !== undefined) {
        sets.push(`${key} = :${key}`);
        params[key] = value;
      }
    }
    if (sets.length > 0) {
      this.db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = :id`).run(params);
    }
    const row = this.findById(id);
    if (!row) throw new HttpError(404, "user_not_found");
    if (patch.color !== undefined) this.events.emit("user.updated", { user: toPublicUser(row) });
    return row;
  }

  /** Owner-only: admin ↔ user. The Owner's own role can't be changed here. */
  setRole(id: number, role: "admin" | "user"): UserRow {
    const row = this.findById(id);
    if (!row) throw new HttpError(404, "user_not_found");
    if (row.role === "owner")
      throw new HttpError(403, "owner_immutable", "the Owner's role cannot be changed");
    this.setRoleStmt.run({ id, role });
    const updated = this.findById(id) as UserRow;
    this.events.emit("user.updated", { user: toPublicUser(updated) });
    return updated;
  }

  /** Makes `toId` the Owner and demotes the current Owner to Admin, atomically. */
  transferOwnership(fromId: number, toId: number): { from: UserRow; to: UserRow } {
    const from = this.findById(fromId);
    const to = this.findById(toId);
    if (from?.role !== "owner") throw new HttpError(403, "not_owner");
    if (!to) throw new HttpError(404, "user_not_found");
    if (from.id === to.id) throw new HttpError(400, "already_owner", "you are already the Owner");

    withTransaction(this.db, () => {
      this.setRoleStmt.run({ id: from.id, role: "admin" });
      this.setRoleStmt.run({ id: to.id, role: "owner" });
    });
    const result = { from: this.findById(from.id) as UserRow, to: this.findById(to.id) as UserRow };
    this.events.emit("user.updated", { user: toPublicUser(result.from) });
    this.events.emit("user.updated", { user: toPublicUser(result.to) });
    return result;
  }

  /**
   * Deletes a user. FK cascades remove sessions, slots, slot_printers, and image rows (§3.1);
   * image files and per-slot events are handled by later phases via this same path.
   */
  /** Runs after a user is deleted with every image row they uploaded (avatar included). */
  onDelete(hook: (payload: { user: PublicUser; images: Image[] }) => void): void {
    this.onDeleteHooks.push(hook);
  }

  /** Points the profile at an image row (or none). The caller handles the old file. */
  setAvatar(id: number, imageId: number | null): UserRow {
    this.setAvatarStmt.run({ id, image_id: imageId });
    const row = this.findById(id);
    if (!row) throw new HttpError(404, "user_not_found");
    this.events.emit("user.updated", { user: toPublicUser(row) });
    return row;
  }

  delete(id: number): DeleteUserResult {
    const row = this.findById(id);
    if (!row) throw new HttpError(404, "user_not_found");
    if (row.role === "owner")
      throw new HttpError(403, "owner_immutable", "the Owner cannot be deleted");

    const count = (sql: string) => (this.db.prepare(sql).get({ id }) as { n: number }).n;
    const affectedSlots = this.slots.listByUser(id);
    const uploaded = this.db
      .prepare("SELECT * FROM images WHERE uploader_id = :id")
      .all({ id }) as unknown as Image[];
    const cascaded = withTransaction(this.db, () => {
      const c = {
        sessions: count("SELECT COUNT(*) AS n FROM sessions WHERE user_id = :id"),
        slots: affectedSlots.length,
        images: uploaded.length,
      };
      // FK cascades remove sessions, slots, slot_printers, and image rows.
      this.deleteStmt.run({ id });
      return c;
    });
    // Each cascaded slot goes through the same cleanup/event path as a manual delete (§3.1).
    for (const slot of affectedSlots) this.slots.notifyCascaded(slot, "user_deleted");
    const user = toPublicUser(row);
    for (const hook of this.onDeleteHooks) hook({ user, images: uploaded });
    this.events.emit("user.deleted", { user });
    return { user, cascaded };
  }
}
