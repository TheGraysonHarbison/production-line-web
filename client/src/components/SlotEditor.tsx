import type { ConflictResponse } from "@production-line/shared";
import { SLOT_HORIZON_MS } from "@production-line/shared";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../lib/api.ts";
import { useMe } from "../lib/auth.tsx";
import { usePrinters, useSlot, useSlotMutations, useSlotsRange } from "../lib/data.ts";
import { useEditor } from "../lib/editor.tsx";
import { useTimeFormat, useTimeZone } from "../lib/prefs.ts";
import { canEditSlot, findConflicts, slotIsRunning } from "../lib/slots.ts";
import {
  formatRange,
  inputsFromIso,
  isoFromInputs,
  isoFromMs,
  snapIsoToFive,
} from "../lib/time.ts";
import {
  buttonClass,
  dangerButtonClass,
  Field,
  inputClass,
  linkButtonClass,
  secondaryButtonClass,
} from "./Field.tsx";
import { CloseIcon } from "./Icons.tsx";
import { errorNoticeClass } from "./Notice.tsx";
import { SlotImages } from "./SlotImages.tsx";

const ERROR_TEXT: Record<string, string> = {
  slot_in_past: "The start time is in the past.",
  slot_end_before_start: "The end must be after the start.",
  slot_too_short: "Slots must be at least 5 minutes long.",
  slot_beyond_horizon: "Slots can end at most 30 days from now.",
  slot_running_start_locked: "A running slot's start time can't be moved.",
  printer_invisible: "That printer isn't bookable right now.",
  printer_not_found: "That printer no longer exists.",
  not_slot_owner: "Only the slot's owner or an admin can change it.",
  slot_not_found: "This slot no longer exists.",
};

/**
 * The one slot editor (dev doc §11.2), a native <dialog> so focus trapping and Escape come free.
 * On phones it becomes a full-screen sheet. Printers already booked for the chosen range are
 * disabled with a tooltip naming who has them; the server still has the final say and its 409 is
 * shown here.
 */
export function SlotEditor({ sheet = false }: { sheet?: boolean }) {
  const editor = useEditor();
  const open = editor.request !== null;
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={editor.close}
      className={`glass-strong glass-in p-0 text-ink ${
        sheet
          ? "m-0 h-dvh max-h-dvh w-screen max-w-none rounded-none border-0"
          : "w-[min(40rem,calc(100vw-2rem))] rounded-2xl"
      }`}
      aria-labelledby="slot-editor-title"
      data-testid="slot-editor"
      data-sheet={sheet ? "true" : "false"}
    >
      {editor.request ? (
        <EditorForm
          key={editor.request.mode === "edit" ? editor.request.slot.id : "new"}
          sheet={sheet}
        />
      ) : null}
    </dialog>
  );
}

function EditorForm({ sheet }: { sheet: boolean }) {
  const editor = useEditor();
  const request = editor.request as NonNullable<typeof editor.request>;
  const tz = useTimeZone();
  const fmt = useTimeFormat();
  const me = useMe();
  const printers = usePrinters();
  const { create, update, remove } = useSlotMutations();
  const editing = request.mode === "edit" ? request.slot : null;
  // Images change outside this form (uploads, other sessions), so read the live copy for them.
  const live = useSlot(editing?.id);
  const liveSlot = live.data ?? editing;
  const defaults = request.mode === "create" ? request.defaults : undefined;
  const now = Date.now();

  const initialStart =
    editing?.start_at ?? defaults?.start_at ?? snapIsoToFive(isoFromMs(now), "ceil");
  const initialEnd =
    editing?.end_at ?? defaults?.end_at ?? isoFromMs(Date.parse(initialStart) + 60 * 60_000);
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [start, setStart] = useState(inputsFromIso(initialStart, tz));
  const [end, setEnd] = useState(inputsFromIso(initialEnd, tz));
  const [printerIds, setPrinterIds] = useState<number[]>(
    editing?.printers.map((p) => p.id) ?? defaults?.printer_ids ?? [],
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startIso = safeIso(start, tz);
  const endIso = safeIso(end, tz);
  const running = editing ? slotIsRunning(editing, now) : false;
  const readOnly = editing ? !canEditSlot(me.data, editing) : false;

  // Slots around the chosen range, for the client-side conflict pre-filter.
  const windowFrom = startIso ? isoFromMs(Date.parse(startIso) - 24 * 3_600_000) : isoFromMs(now);
  const windowTo = endIso
    ? isoFromMs(Date.parse(endIso) + 24 * 3_600_000)
    : isoFromMs(now + 24 * 3_600_000);
  const nearby = useSlotsRange(windowFrom, windowTo);
  const conflicts = useMemo(
    () =>
      startIso && endIso
        ? findConflicts(
            nearby.data ?? [],
            printers.data ?? [],
            { start_at: startIso, end_at: endIso },
            editing?.id,
          )
        : new Map(),
    [nearby.data, printers.data, startIso, endIso, editing?.id],
  );

  const pending = create.isPending || update.isPending || remove.isPending;
  const error = create.error ?? update.error ?? remove.error;
  const apiError = error instanceof ApiError ? error : null;
  const conflict =
    apiError?.status === 409 && apiError.code === "conflict"
      ? (apiError.body as unknown as ConflictResponse)
      : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!startIso || !endIso) return;
    const body = {
      name,
      description: description.trim() === "" ? null : description,
      start_at: startIso,
      end_at: endIso,
      printer_ids: printerIds,
    };
    if (editing) {
      const patch: Record<string, unknown> = {
        id: editing.id,
        name: body.name,
        description: body.description,
        end_at: body.end_at,
        printer_ids: body.printer_ids,
      };
      if (!running) patch.start_at = body.start_at;
      update.mutate(patch as Parameters<typeof update.mutate>[0], { onSuccess: editor.close });
    } else {
      create.mutate(body, { onSuccess: editor.close });
    }
  };

  const togglePrinter = (id: number) =>
    setPrinterIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const maxEndIso = isoFromMs(now + SLOT_HORIZON_MS);
  const title = editing ? (readOnly ? "Slot" : "Edit slot") : "New slot";

  return (
    <form
      onSubmit={submit}
      className={`flex flex-col gap-4 ${sheet ? "min-h-dvh p-4 pb-6" : "p-5"}`}
      noValidate
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 id="slot-editor-title" className="font-semibold text-xl">
            {title}
          </h2>
          {editing ? (
            <p className="text-ink-muted text-sm">
              {editing.user.username} · {formatRange(editing.start_at, editing.end_at, tz, fmt)}
              {running ? " · running" : ""}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink-muted hover:bg-accent-soft hover:text-ink"
          onClick={editor.close}
          aria-label="Close"
        >
          <CloseIcon />
        </button>
      </div>

      <Field label="Name" htmlFor="slot-name" error={apiError?.fieldMessage("name")}>
        <input
          id="slot-name"
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
          disabled={readOnly}
        />
      </Field>
      <Field
        label="Description"
        htmlFor="slot-description"
        error={apiError?.fieldMessage("description")}
      >
        <textarea
          id="slot-description"
          className={inputClass}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={2}
          disabled={readOnly}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Start"
          htmlFor="slot-start-date"
          hint={running ? "Locked while the slot is running" : undefined}
        >
          <div className="flex gap-2">
            <input
              id="slot-start-date"
              type="date"
              className={`${inputClass} min-w-0 flex-1`}
              value={start.date}
              onChange={(e) => setStart({ ...start, date: e.target.value })}
              disabled={readOnly || running}
              required
            />
            <input
              aria-label="Start time"
              type="time"
              step={300}
              className={`${inputClass} min-w-0 flex-1`}
              value={start.time}
              onChange={(e) => setStart({ ...start, time: e.target.value })}
              disabled={readOnly || running}
              required
            />
          </div>
        </Field>
        <Field
          label="End"
          htmlFor="slot-end-date"
          hint={editing && running ? "Extend up to the next booking on each printer" : undefined}
        >
          <div className="flex gap-2">
            <input
              id="slot-end-date"
              type="date"
              className={`${inputClass} min-w-0 flex-1`}
              value={end.date}
              onChange={(e) => setEnd({ ...end, date: e.target.value })}
              max={inputsFromIso(maxEndIso, tz).date}
              disabled={readOnly}
              required
            />
            <input
              aria-label="End time"
              type="time"
              step={300}
              className={`${inputClass} min-w-0 flex-1`}
              value={end.time}
              onChange={(e) => setEnd({ ...end, time: e.target.value })}
              disabled={readOnly}
              required
            />
          </div>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium text-sm">Printers</legend>
        {printers.data?.map((p) => {
          const onSlot = editing?.printers.some((x) => x.id === p.id) ?? false;
          const c = conflicts.get(p.id);
          const blockedByServer = conflict?.printers.find((x) => x.id === p.id);
          const disabled =
            readOnly || (p.invisible && !onSlot) || (!!c && !printerIds.includes(p.id));
          const why = c
            ? `Booked by ${c.slot.user.username}: ${c.slot.name} (${formatRange(c.slot.start_at, c.slot.end_at, tz, fmt)})`
            : p.invisible
              ? "Not bookable"
              : undefined;
          return (
            <label
              key={p.id}
              className={`flex min-h-11 items-center gap-3 rounded-lg px-2 py-1 ${disabled ? "opacity-60" : "hover:bg-accent-soft"} ${blockedByServer ? "bg-danger-soft" : ""}`}
              title={why}
            >
              <input
                type="checkbox"
                className="accent-accent"
                checked={printerIds.includes(p.id)}
                onChange={() => togglePrinter(p.id)}
                disabled={disabled}
                aria-describedby={why ? `why-${p.id}` : undefined}
              />
              <span>{p.name}</span>
              {why ? (
                <span id={`why-${p.id}`} className="text-ink-muted text-xs">
                  {why}
                </span>
              ) : null}
            </label>
          );
        })}
      </fieldset>

      {liveSlot ? <SlotImages slot={liveSlot} canEdit={!readOnly} /> : null}

      {conflict ? (
        <div className={errorNoticeClass} role="alert">
          <p className="font-medium">{conflict.message ?? "Those printers are already booked."}</p>
          <ul className="mt-1 list-disc pl-5">
            {conflict.printers.map((p) => (
              <li key={p.id}>
                {p.name}: {p.slot.name} by {p.slot.user.username},{" "}
                {formatRange(p.slot.start_at, p.slot.end_at, tz, fmt)}
              </li>
            ))}
          </ul>
        </div>
      ) : apiError && !apiError.body.issues ? (
        <p className={errorNoticeClass} role="alert">
          {ERROR_TEXT[apiError.code] ?? apiError.message}
        </p>
      ) : apiError?.body.issues &&
        !apiError.fieldMessage("name") &&
        !apiError.fieldMessage("description") ? (
        <p className={errorNoticeClass} role="alert">
          {apiError.body.issues.map((i) => i.message).join(" ")}
        </p>
      ) : null}

      <div className={`flex flex-wrap items-center gap-2 pt-2 ${sheet ? "mt-auto" : ""}`}>
        {!readOnly ? (
          <button
            type="submit"
            className={buttonClass}
            disabled={pending || printerIds.length === 0 || !startIso || !endIso}
          >
            {editing ? "Save" : "Create slot"}
          </button>
        ) : null}
        <button type="button" className={secondaryButtonClass} onClick={editor.close}>
          {readOnly ? "Close" : "Cancel"}
        </button>
        {editing && !readOnly ? (
          confirmDelete ? (
            <span className="ml-auto flex flex-wrap items-center gap-2 text-sm">
              Delete this slot?
              <button
                type="button"
                className={dangerButtonClass}
                onClick={() => remove.mutate(editing.id, { onSuccess: editor.close })}
                disabled={pending}
              >
                Yes, delete
              </button>
              <button
                type="button"
                className={linkButtonClass}
                onClick={() => setConfirmDelete(false)}
              >
                No
              </button>
            </span>
          ) : (
            <button
              type="button"
              className={`${linkButtonClass} ml-auto text-danger hover:text-danger`}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          )
        ) : null}
      </div>
    </form>
  );
}

function safeIso(v: { date: string; time: string }, tz: string): string | null {
  if (!v.date || !v.time) return null;
  try {
    return isoFromInputs(v.date, v.time, tz);
  } catch {
    return null;
  }
}
