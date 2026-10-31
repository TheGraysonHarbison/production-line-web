import type { DatabaseSync } from "node:sqlite";
import {
  type ConflictResponse,
  type CreateSlotBody,
  type Image,
  isRunning,
  type Printer,
  type PublicUser,
  roundToFiveMinutes,
  SLOT_HORIZON_MS,
  SLOT_MIN_LENGTH_MS,
  type Slot,
  type UpdateSlotBody,
} from "@production-line/shared";
import { withTransaction } from "../db/connection.js";
import { HttpError } from "../errors.js";
import type { AppEvents } from "../events.js";
import { toPrinter } from "./printers.js";
import { toPublicUser, type UserRow } from "./users.js";

export type DeleteReason = "manual" | "expired" | "user_deleted";

interface SlotRow {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  start_at: string;
  end_at: string;
  created_at: string;
  updated_at: string;
}

interface PrinterLinkRow {
  id: number;
  name: string;
  invisible: number;
  created_at: string;
  slot_id: number;
}

interface ConflictRow {
  id: number;
  name: string;
  start_at: string;
  end_at: string;
  user_id: number;
}

/** Thrown when a printer is taken; the error handler sends the §7 `409 conflict` body. */
export class SlotConflictError extends HttpError {
  constructor(
    readonly printers: ConflictResponse["printers"],
    message: string,
  ) {
    super(409, "conflict", message, { printers });
  }
}

/** Slot engine (dev doc §3.3): the server is the single authority on scheduling conflicts. */
export class SlotsService {
  private readonly byId;
  private readonly byRange;
  private readonly byUser;
  private readonly insert;
  private readonly insertLink;
  private readonly deleteLinks;
  private readonly deleteStmt;
  private readonly conflict;
  private readonly printersFor;
  private readonly imagesFor;
  private readonly userById;
  private readonly onDeleteHooks: ((slot: Slot, reason: DeleteReason) => void)[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly events: AppEvents,
  ) {
    this.byId = db.prepare("SELECT * FROM slots WHERE id = :id");
    this.byRange = db.prepare(
      "SELECT * FROM slots WHERE start_at < :to AND end_at > :from ORDER BY start_at, id",
    );
    this.byUser = db.prepare("SELECT * FROM slots WHERE user_id = :user_id ORDER BY start_at, id");
    this.insert = db.prepare(
      `INSERT INTO slots (user_id, name, description, start_at, end_at, created_at, updated_at)
       VALUES (:user_id, :name, :description, :start_at, :end_at, :now, :now)`,
    );
    this.insertLink = db.prepare(
      "INSERT INTO slot_printers (slot_id, printer_id) VALUES (:slot_id, :printer_id)",
    );
    this.deleteLinks = db.prepare("DELETE FROM slot_printers WHERE slot_id = :slot_id");
    this.deleteStmt = db.prepare("DELETE FROM slots WHERE id = :id");
    // Dev doc §6 conflict query, run per printer inside the write transaction.
    this.conflict = db.prepare(
      `SELECT s.id, s.name, s.start_at, s.end_at, s.user_id FROM slots s
       JOIN slot_printers sp ON sp.slot_id = s.id
       WHERE sp.printer_id = :printer_id
         AND s.id != :exclude_slot_id
         AND s.start_at < :new_end_at
         AND s.end_at   > :new_start_at
       ORDER BY s.start_at LIMIT 1`,
    );
    this.printersFor = db.prepare(
      `SELECT p.*, sp.slot_id FROM printers p JOIN slot_printers sp ON sp.printer_id = p.id
       WHERE sp.slot_id IN (SELECT value FROM json_each(:ids)) ORDER BY p.name COLLATE NOCASE`,
    );
    this.imagesFor = db.prepare(
      "SELECT * FROM images WHERE slot_id IN (SELECT value FROM json_each(:ids)) ORDER BY created_at, id",
    );
    this.userById = db.prepare("SELECT * FROM users WHERE id = :id");
  }

  /** Later phases register cleanup (image files) that must run when a slot goes away. */
  onDelete(hook: (slot: Slot, reason: DeleteReason) => void): void {
    this.onDeleteHooks.push(hook);
  }

  get(id: number): Slot {
    const row = this.byId.get({ id }) as SlotRow | undefined;
    if (!row) throw new HttpError(404, "slot_not_found");
    return this.hydrate([row])[0] as Slot;
  }

  listRange(from: string, to: string): Slot[] {
    return this.hydrate(this.byRange.all({ from, to }) as unknown as SlotRow[]);
  }

  listByUser(userId: number): Slot[] {
    return this.hydrate(this.byUser.all({ user_id: userId }) as unknown as SlotRow[]);
  }

  listExpired(nowIso: string): Slot[] {
    const rows = this.db
      .prepare("SELECT * FROM slots WHERE end_at <= :now ORDER BY end_at, id")
      .all({ now: nowIso }) as unknown as SlotRow[];
    return this.hydrate(rows);
  }

  create(user: UserRow, body: CreateSlotBody, now: Date = new Date()): Slot {
    const start_at = roundToFiveMinutes(body.start_at);
    const end_at = roundToFiveMinutes(body.end_at);
    this.validateTimes(start_at, end_at, now, { checkPast: true });

    const slot = withTransaction(this.db, () => {
      const printers = this.resolvePrinters(body.printer_ids, { forbidInvisible: true });
      this.assertFree(printers, start_at, end_at, 0, "create");
      const result = this.insert.run({
        user_id: user.id,
        name: body.name,
        description: body.description ?? null,
        start_at,
        end_at,
        now: now.toISOString(),
      });
      const id = Number(result.lastInsertRowid);
      for (const p of printers) this.insertLink.run({ slot_id: id, printer_id: p.id });
      return this.get(id);
    });
    this.events.emit("slot.created", { slot });
    return slot;
  }

  update(id: number, body: UpdateSlotBody, now: Date = new Date()): Slot {
    const current = this.get(id);
    const nowIso = now.toISOString();
    const running = isRunning(current, nowIso);

    const start_at =
      body.start_at !== undefined ? roundToFiveMinutes(body.start_at) : current.start_at;
    const end_at = body.end_at !== undefined ? roundToFiveMinutes(body.end_at) : current.end_at;
    const startChanged = start_at !== current.start_at;
    const timesChanged = startChanged || end_at !== current.end_at;
    const printersChanged = body.printer_ids !== undefined;

    if (running && startChanged) {
      throw new HttpError(
        400,
        "slot_running_start_locked",
        "a running slot's start time cannot be moved",
      );
    }
    this.validateTimes(start_at, end_at, now, { checkPast: startChanged });

    const slot = withTransaction(this.db, () => {
      if (timesChanged || printersChanged) {
        // Only newly added printers must be visible; printers already on the slot stay (§3.2).
        const keep = new Set(current.printers.map((p) => p.id));
        const ids = body.printer_ids ?? current.printers.map((p) => p.id);
        const printers = this.resolvePrinters(ids, { forbidInvisible: true, allow: keep });
        const mode =
          !startChanged && !printersChanged && Date.parse(end_at) > Date.parse(current.end_at)
            ? "extend"
            : "update";
        this.assertFree(printers, start_at, end_at, id, mode);
        if (printersChanged) {
          this.deleteLinks.run({ slot_id: id });
          for (const p of printers) this.insertLink.run({ slot_id: id, printer_id: p.id });
        }
      }
      this.db
        .prepare(
          `UPDATE slots SET name = :name, description = :description, start_at = :start_at, end_at = :end_at,
           updated_at = :now WHERE id = :id`,
        )
        .run({
          id,
          name: body.name ?? current.name,
          description: body.description === undefined ? current.description : body.description,
          start_at,
          end_at,
          now: nowIso,
        });
      return this.get(id);
    });
    this.events.emit("slot.updated", { slot });
    return slot;
  }

  /** Removes the slot (links cascade), runs cleanup hooks, and emits the matching event. */
  delete(id: number, reason: DeleteReason): Slot {
    const slot = this.get(id);
    this.deleteStmt.run({ id });
    for (const hook of this.onDeleteHooks) hook(slot, reason);
    this.events.emit(reason === "expired" ? "slot.expired" : "slot.deleted", { slot });
    return slot;
  }

  /** For rows removed by an FK cascade (user deletion): run hooks and emit without touching the DB. */
  notifyCascaded(slot: Slot, reason: DeleteReason): void {
    for (const hook of this.onDeleteHooks) hook(slot, reason);
    this.events.emit("slot.deleted", { slot });
  }

  /** Builds full Slot objects (user, printers, images) for a set of rows in three queries. */
  hydrate(rows: SlotRow[]): Slot[] {
    if (rows.length === 0) return [];
    const ids = JSON.stringify(rows.map((r) => r.id));
    const printersBySlot = new Map<number, Printer[]>();
    for (const row of this.printersFor.all({ ids }) as unknown as PrinterLinkRow[]) {
      const list = printersBySlot.get(row.slot_id) ?? [];
      list.push(toPrinter(row));
      printersBySlot.set(row.slot_id, list);
    }
    const imagesBySlot = new Map<number, Image[]>();
    for (const img of this.imagesFor.all({ ids }) as unknown as Image[]) {
      const list = imagesBySlot.get(img.slot_id as number) ?? [];
      list.push(img);
      imagesBySlot.set(img.slot_id as number, list);
    }
    const users = new Map<number, PublicUser>();
    return rows.map((r) => {
      let user = users.get(r.user_id);
      if (!user) {
        user = toPublicUser(this.userById.get({ id: r.user_id }) as unknown as UserRow);
        users.set(r.user_id, user);
      }
      return {
        id: r.id,
        user,
        name: r.name,
        description: r.description,
        start_at: r.start_at,
        end_at: r.end_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
        printers: printersBySlot.get(r.id) ?? [],
        images: imagesBySlot.get(r.id) ?? [],
      };
    });
  }

  private validateTimes(
    start_at: string,
    end_at: string,
    now: Date,
    opts: { checkPast: boolean },
  ): void {
    const start = Date.parse(start_at);
    const end = Date.parse(end_at);
    if (end <= start) throw new HttpError(400, "slot_end_before_start", "end must be after start");
    if (end - start < SLOT_MIN_LENGTH_MS)
      throw new HttpError(400, "slot_too_short", "slots are at least 5 minutes");
    if (opts.checkPast && start < Date.parse(roundToFiveMinutes(now.toISOString()))) {
      throw new HttpError(400, "slot_in_past", "start cannot be in the past");
    }
    if (end > now.getTime() + SLOT_HORIZON_MS) {
      throw new HttpError(400, "slot_beyond_horizon", "slots may end at most 30 days from now");
    }
  }

  private resolvePrinters(
    ids: number[],
    opts: { forbidInvisible: boolean; allow?: Set<number> },
  ): Printer[] {
    const printers: Printer[] = [];
    for (const id of ids) {
      const row = this.db.prepare("SELECT * FROM printers WHERE id = :id").get({ id }) as
        | (Printer & { invisible: number })
        | undefined;
      if (!row)
        throw new HttpError(400, "printer_not_found", `printer ${id} does not exist`, {
          printer_id: id,
        });
      const printer = toPrinter(row);
      if (opts.forbidInvisible && printer.invisible && !opts.allow?.has(printer.id)) {
        throw new HttpError(
          400,
          "printer_invisible",
          `${printer.name} is not available for booking`,
          {
            printer_id: id,
          },
        );
      }
      printers.push(printer);
    }
    return printers;
  }

  private assertFree(
    printers: Printer[],
    start_at: string,
    end_at: string,
    excludeId: number,
    mode: "create" | "update" | "extend",
  ): void {
    const taken: ConflictResponse["printers"] = [];
    for (const p of printers) {
      const hit = this.conflict.get({
        printer_id: p.id,
        exclude_slot_id: excludeId,
        new_end_at: end_at,
        new_start_at: start_at,
      }) as ConflictRow | undefined;
      if (!hit) continue;
      const user = toPublicUser(this.userById.get({ id: hit.user_id }) as unknown as UserRow);
      taken.push({
        id: p.id,
        name: p.name,
        slot: { id: hit.id, name: hit.name, start_at: hit.start_at, end_at: hit.end_at, user },
      });
    }
    if (taken.length === 0) return;
    const names = taken
      .map((t) => `${t.name} (${t.slot.name} by ${t.slot.user.username})`)
      .join(", ");
    const message =
      mode === "extend"
        ? `cannot extend: blocked by ${names}`
        : `printer${taken.length > 1 ? "s" : ""} already booked: ${names}`;
    throw new SlotConflictError(taken, message);
  }
}
