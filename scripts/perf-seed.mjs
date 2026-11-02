#!/usr/bin/env node
// Performance sanity (roadmap Phase 10): seed 10 printers × 500 slots over 62 days into a fresh
// DATA_DIR, boot the built server on it, and time the range query the calendar and the timeline
// strip make. Usage: node scripts/perf-seed.mjs [data-dir] [port]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const REPO = new URL("..", import.meta.url).pathname;
const dataDir = process.argv[2] ?? mkdtempSync(join(tmpdir(), "plw-perf-"));
const port = Number(process.argv[3] ?? 8097);
const base = `http://127.0.0.1:${port}`;
const PRINTERS = 10;
const SLOTS_PER_PRINTER = 500;
const DAYS = 62;

// 1. Boot once so migrations create the schema, then stop.
function start() {
  return spawn("node", ["server/dist/index.js"], {
    cwd: REPO,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      LOG_LEVEL: "warn",
      RATE_LIMIT_MAX: "100000",
      RATE_LIMIT_AUTH_MAX: "1000",
    },
    stdio: "ignore",
  });
}
async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/meta`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not come up");
}
const stop = (child) =>
  new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
  });

let server = start();
await waitUp();
const H = { origin: base, "content-type": "application/json" };
const setup = await fetch(`${base}/api/setup`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    username: "owner",
    password: "ownerpass1",
    favorite_color: "#4f9cff",
    timezone: "America/New_York",
  }),
});
if (setup.status !== 201) throw new Error(`setup ${setup.status}`);
const cookie = setup.headers.get("set-cookie").split(";")[0];
await stop(server);

// 2. Seed straight into SQLite: 10 printers, 500 non-overlapping slots each, spread over 62 days.
const db = new DatabaseSync(join(dataDir, "app.db"));
db.exec("PRAGMA foreign_keys = ON;");
const now = new Date().toISOString();
db.exec("BEGIN;");
const insPrinter = db.prepare(
  "INSERT INTO printers (name, invisible, created_at) VALUES (:name, 0, :now)",
);
const insSlot = db.prepare(
  "INSERT INTO slots (user_id, name, description, start_at, end_at, created_at, updated_at) VALUES (1, :name, NULL, :s, :e, :now, :now)",
);
const link = db.prepare("INSERT INTO slot_printers (slot_id, printer_id) VALUES (:slot, :printer)");
const t0 = Math.floor(Date.now() / 300000) * 300000 - 10 * 86400000; // ten days of history, 52 ahead
const span = DAYS * 86400000;
const step = span / SLOTS_PER_PRINTER; // ~3 h apart
for (let p = 1; p <= PRINTERS; p++) {
  const printerId = Number(insPrinter.run({ name: `Printer ${p}`, now }).lastInsertRowid);
  for (let i = 0; i < SLOTS_PER_PRINTER; i++) {
    const s = Math.round((t0 + i * step + (p % 3) * 600000) / 300000) * 300000;
    const e = s + 90 * 60000; // 90-minute prints
    const slotId = Number(
      insSlot.run({
        name: `Job ${p}-${i}`,
        s: new Date(s).toISOString(),
        e: new Date(e).toISOString(),
        now,
      }).lastInsertRowid,
    );
    link.run({ slot: slotId, printer: printerId });
  }
}
db.exec("COMMIT;");
db.close();

// 3. Measure the two queries the UI makes, warm, median of 5.
server = start();
await waitUp();
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function time(label, from, to) {
  const url = `${base}/api/slots?from=${from.toISOString()}&to=${to.toISOString()}`;
  const samples = [];
  let count = 0;
  for (let i = 0; i < 6; i++) {
    const t = performance.now();
    const res = await fetch(url, { headers: { cookie } });
    const rows = await res.json();
    if (i > 0) samples.push(performance.now() - t);
    count = rows.length;
  }
  console.log(
    `${label}: ${count} slots, median ${median(samples).toFixed(0)} ms (min ${Math.min(...samples).toFixed(0)}, max ${Math.max(...samples).toFixed(0)})`,
  );
}
const nowMs = Date.now();
await time(
  "62-day calendar range  ",
  new Date(nowMs - 10 * 86400000),
  new Date(nowMs + 52 * 86400000),
);
await time("31-day timeline strip  ", new Date(nowMs - 3600000), new Date(nowMs + 31 * 86400000));
await time("1-day range            ", new Date(nowMs), new Date(nowMs + 86400000));
const meta = await fetch(`${base}/api/meta`);
console.log(`health: ${meta.status}; data dir: ${dataDir}`);
if (process.argv.includes("--keep")) {
  console.log(`server left running on ${base} (pid ${server.pid}); owner/ownerpass1`);
} else {
  await stop(server);
}
