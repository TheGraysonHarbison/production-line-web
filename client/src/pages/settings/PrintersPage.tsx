import type { Printer } from "@production-line/shared";
import { type FormEvent, useState } from "react";
import {
  buttonClass,
  Field,
  inputClass,
  linkButtonClass,
  secondaryButtonClass,
} from "../../components/Field.tsx";
import { ErrorNotice } from "../../components/Notice.tsx";
import { usePrinterMutations, usePrinters } from "../../lib/data.ts";

const ERRORS = {
  printer_name_taken: "A printer with that name already exists.",
  printer_in_use: "This printer is part of existing slots and can't be deleted.",
};

function PrinterRow({ printer }: { printer: Printer }) {
  const { update, remove } = usePrinterMutations();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(printer.name);

  const rename = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() === printer.name) return setEditing(false);
    update.mutate({ id: printer.id, name }, { onSuccess: () => setEditing(false) });
  };

  return (
    <li
      className="flex flex-col gap-2 rounded-xl border border-line bg-canvas/40 p-3"
      data-testid="printer-row"
    >
      <div className="flex flex-wrap items-center gap-3">
        {editing ? (
          <form onSubmit={rename} className="flex flex-wrap items-center gap-2">
            <input
              aria-label={`Rename ${printer.name}`}
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className={buttonClass} disabled={update.isPending}>
              Save
            </button>
            <button type="button" className={linkButtonClass} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <span className={`font-medium ${printer.invisible ? "opacity-60" : ""}`}>
            {printer.name}
          </span>
        )}
        {printer.invisible ? (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs">invisible</span>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-1 text-sm">
          <button type="button" className={linkButtonClass} onClick={() => setEditing(true)}>
            Rename
          </button>
          <button
            type="button"
            className={linkButtonClass}
            onClick={() => update.mutate({ id: printer.id, invisible: !printer.invisible })}
            disabled={update.isPending}
          >
            {printer.invisible ? `Show ${printer.name}` : `Hide ${printer.name}`}
          </button>
          <button
            type="button"
            className={`${linkButtonClass} text-danger hover:text-danger`}
            onClick={() => {
              if (window.confirm(`Delete printer "${printer.name}"?`)) remove.mutate(printer.id);
            }}
            disabled={remove.isPending}
          >
            Delete {printer.name}
          </button>
        </div>
      </div>
      <ErrorNotice error={update.error ?? remove.error} map={ERRORS} />
    </li>
  );
}

export function PrintersPage() {
  const printers = usePrinters();
  const { create } = usePrinterMutations();
  const [name, setName] = useState("");

  const add = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ name }, { onSuccess: () => setName("") });
  };

  return (
    <section className="flex flex-col gap-6">
      <h2 className="font-semibold text-2xl">Printers</h2>
      <p className="text-ink-muted text-sm">
        Invisible printers can't be added to new slots but stay on existing ones. A printer that is
        part of any slot can't be deleted.
      </p>
      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <Field label="Printer name" htmlFor="printer-name">
          <input
            id="printer-name"
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            required
          />
        </Field>
        <button
          type="submit"
          className={secondaryButtonClass}
          disabled={create.isPending || !name.trim()}
        >
          Add printer
        </button>
      </form>
      <ErrorNotice error={create.error} map={ERRORS} />
      {printers.isPending ? <p className="text-ink-muted text-sm">Loading…</p> : null}
      {printers.data?.length === 0 ? (
        <p className="text-ink-muted text-sm">No printers yet.</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {printers.data?.map((p) => (
          <PrinterRow key={p.id} printer={p} />
        ))}
      </ul>
    </section>
  );
}
