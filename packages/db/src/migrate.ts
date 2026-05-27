import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

// Resolve `drizzle/` relative to this file, not the caller's CWD. The script
// is run from arbitrary working directories (the worker image runs it from
// /app, dev runs it from packages/db, etc).
const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "..", "drizzle");

async function main() {
  const client = postgres(url!, { max: 1 });
  const db = drizzle(client);
  console.log(`Running migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log("Migrations complete.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
