import type { DatabaseSync } from "node:sqlite";
import type { Printer } from "@production-line/shared";
import { HttpError } from "../errors.js";
import type { AppEvents } from "../events.js";

interface PrinterRow {
  id: number;
  name: string;
  invisible: number;
  created_at: string;
}

export interface UpdatePrinterInput {
  name?: string | undefined;
  invisible?: boolean | undefined;
}

export function toPrinter(row: PrinterRow): Printer {
  return { id: row.id, name: row.name, invisible: row.invisible === 1, created_at: row.created_at };
}

/** Printers (dev doc §3.2): bookable resources with a case-insensitively unique name. */
export class PrintersService {
  private readonly listStmt;
  private readonly byId;
  private readonly insert;
  private readonly deleteStmt;
  private readonly inUse;

  constructor(
    private readonly db: DatabaseSync,
    private readonly events: AppEvents,
  ) {
    this.listStmt = db.prepare("SELECT * FROM printers ORDER BY name COLLATE NOCASE");
    this.byId = db.prepare("SELECT * FROM printers WHERE id = :id");
    this.insert = db.prepare(
      "INSERT INTO printers (name, invisible, created_at) VALUES (:name, :invisible, :created_at)",
    );
    this.deleteStmt = db.prepare("DELETE FROM printers WHERE id = :id");
    this.inUse = db.prepare(
      `SELECT s.id, s.name FROM slots s JOIN slot_printers sp ON sp.slot_id = s.id
       WHERE sp.printer_id = :id ORDER BY s.start_at`,
    );
  }

  list(): Printer[] {
    return (this.listStmt.all() as unknown as PrinterRow[]).map(toPrinter);
  }

  findById(id: number): Printer | null {
    const row = this.byId.get({ id }) as PrinterRow | undefined;
    return row ? toPrinter(row) : null;
  }

  private get(id: number): Printer {
    const printer = this.findById(id);
    if (!printer) throw new HttpError(404, "printer_not_found");
    return printer;
  }

  create(input: { name: string; invisible?: boolean | undefined }): Printer {
    try {
      const result = this.insert.run({
        name: input.name,
        invisible: input.invisible ? 1 : 0,
        created_at: new Date().toISOString(),
      });
      const printer = this.get(Number(result.lastInsertRowid));
      this.events.emit("printer.created", { printer });
      return printer;
    } catch (err) {
      throw this.mapUnique(err);
    }
  }

  update(id: number, patch: UpdatePrinterInput): Printer {
    this.get(id);
    const sets: string[] = [];
    const params: Record<string, string | number> = { id };
    if (patch.name !== undefined) {
      sets.push("name = :name");
      params.name = patch.name;
    }
    if (patch.invisible !== undefined) {
      sets.push("invisible = :invisible");
      params.invisible = patch.invisible ? 1 : 0;
    }
    if (sets.length > 0) {
      try {
        // sql: `sets` holds fixed "column = :param" fragments; values travel as parameters.
        this.db.prepare(`UPDATE printers SET ${sets.join(", ")} WHERE id = :id`).run(params);
      } catch (err) {
        throw this.mapUnique(err);
      }
    }
    const printer = this.get(id);
    this.events.emit("printer.updated", { printer });
    return printer;
  }

  /** Refused with 409 while any slot still references the printer (dev doc §3.2, D9). */
  delete(id: number): Printer {
    const printer = this.get(id);
    const slots = this.inUse.all({ id }) as unknown as { id: number; name: string }[];
    if (slots.length > 0) {
      throw new HttpError(409, "printer_in_use", "printer is part of existing slots", { slots });
    }
    this.deleteStmt.run({ id });
    this.events.emit("printer.deleted", { printer });
    return printer;
  }

  private mapUnique(err: unknown): unknown {
    if (/UNIQUE constraint failed: printers\.name/.test((err as Error).message)) {
      return new HttpError(409, "printer_name_taken", "a printer with that name already exists");
    }
    return err;
  }
}
