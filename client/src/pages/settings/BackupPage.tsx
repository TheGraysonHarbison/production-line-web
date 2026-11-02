import { buttonClass } from "../../components/Field.tsx";

/** Backup tab (dev doc §16): one download of a consistent database copy; images are not in it. */
export function BackupPage() {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="font-semibold text-2xl">Backup</h2>
      <p className="text-ink-muted text-sm">
        Downloads a consistent copy of the database: users, printers, slots, settings, and the
        encrypted Home Assistant token. The file is a plain SQLite database.
      </p>
      <p className="rounded-lg border border-warn/40 bg-canvas/50 px-3 py-2 text-sm" role="note">
        Images are <strong>not</strong> included. They live under the data directory's{" "}
        <code className="rounded bg-accent-soft px-1 text-ink">images/</code> folder and can be
        copied separately if you want them.
      </p>
      <div>
        <a href="/api/backup" download className={buttonClass} data-testid="download-backup">
          Download backup
        </a>
      </div>
      <section className="flex flex-col gap-2 text-sm" aria-labelledby="restore-title">
        <h3 id="restore-title" className="font-medium">
          Restoring
        </h3>
        <ol className="list-decimal space-y-1 pl-5 text-ink-muted">
          <li>Stop the app.</li>
          <li>
            Replace <code className="rounded bg-accent-soft px-1 text-ink">app.db</code> in the data
            directory with the downloaded file (remove any{" "}
            <code className="rounded bg-accent-soft px-1 text-ink">app.db-wal</code> and{" "}
            <code className="rounded bg-accent-soft px-1 text-ink">app.db-shm</code> next to it).
          </li>
          <li>Start the app. Migrations newer than the backup are applied automatically.</li>
        </ol>
        <p className="text-ink-muted">
          If <code className="rounded bg-accent-soft px-1 text-ink">secret.key</code> was lost as
          well, re-enter the Home Assistant token afterwards.
        </p>
      </section>
    </div>
  );
}
