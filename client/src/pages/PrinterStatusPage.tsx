import { PrinterList } from "../components/PrinterList.tsx";

/** The mobile Printers tab (dev doc §11.1): today's availability per printer, with Book buttons. */
export function PrinterStatusPage() {
  return (
    <main className="flex flex-col gap-4" data-testid="printers-view">
      <h1 className="font-semibold text-2xl">Printers</h1>
      <section className="glass rounded-2xl p-3">
        <PrinterList bookable />
      </section>
    </main>
  );
}
