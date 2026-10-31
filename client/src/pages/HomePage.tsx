import { useMemo } from "react";
import { useMe } from "../lib/auth.tsx";
import { usePrinters, useSlotsRange } from "../lib/data.ts";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Interim home: visible printers and the next week of slots. The calendar/timeline replaces this in Phase 6. */
export function HomePage() {
  const me = useMe();
  const printers = usePrinters();
  // Stable window for the session so the query key (and live patching) stays put.
  const [from, to] = useMemo(() => {
    const start = new Date(Math.floor(Date.now() / 300_000) * 300_000);
    return [start.toISOString(), new Date(start.getTime() + WEEK_MS).toISOString()];
  }, []);
  const slots = useSlotsRange(from, to);
  const visible = printers.data?.filter((p) => !p.invisible) ?? [];
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h2 className="font-semibold text-2xl">Hello, {me.data?.username}</h2>
        <p className="mt-2 opacity-80">The calendar arrives in the next phase.</p>
      </div>
      <section>
        <h3 className="font-medium text-lg">Printers</h3>
        {printers.isPending ? <p className="text-sm opacity-70">Loading…</p> : null}
        {printers.data && visible.length === 0 ? (
          <p className="text-sm opacity-70">No printers yet.</p>
        ) : null}
        <ul className="mt-2 flex flex-col gap-1" data-testid="home-printers">
          {visible.map((p) => (
            <li
              key={p.id}
              className="rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800"
            >
              {p.name}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="font-medium text-lg">Next 7 days</h3>
        {slots.isPending ? <p className="text-sm opacity-70">Loading…</p> : null}
        {slots.data?.length === 0 ? <p className="text-sm opacity-70">No slots booked.</p> : null}
        <ul className="mt-2 flex flex-col gap-1" data-testid="home-slots">
          {slots.data?.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800"
            >
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: s.user.color }}
                aria-hidden="true"
              />
              <span className="font-medium">{s.name}</span>
              <span className="text-sm opacity-70">
                {s.user.username} · {s.printers.map((p) => p.name).join(", ")}
              </span>
              <span className="ml-auto text-sm opacity-70">
                {fmt(s.start_at)} – {fmt(s.end_at)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
