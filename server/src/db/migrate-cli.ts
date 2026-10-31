// `npm run db:migrate` — applies pending migrations to $DATA_DIR/app.db and exits.
import { loadConfig } from "../config.js";
import { bootstrapDataDir } from "../data-dir.js";
import { openDatabase } from "./connection.js";
import { migrate } from "./migrate.js";

const config = loadConfig();
const dataDir = bootstrapDataDir(config.dataDir);
const db = openDatabase(dataDir.dbPath);
try {
  const result = migrate(db);
  if (result.applied.length === 0) {
    console.log(`up to date (schema version ${result.current}) at ${dataDir.dbPath}`);
  } else {
    console.log(
      `applied ${result.applied.join(", ")} (schema version ${result.current}) at ${dataDir.dbPath}`,
    );
  }
} finally {
  db.close();
}
