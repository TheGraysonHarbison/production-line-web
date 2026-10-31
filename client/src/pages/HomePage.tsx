import { useMe } from "../lib/auth.tsx";
import { usePrinters } from "../lib/data.ts";

export function HomePage() {
  const me = useMe();
  const printers = usePrinters();
  const visible = printers.data?.filter((p) => !p.invisible) ?? [];
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h2 className="font-semibold text-2xl">Hello, {me.data?.username}</h2>
        <p className="mt-2 opacity-80">Scheduling arrives in the next phases.</p>
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
    </main>
  );
}
