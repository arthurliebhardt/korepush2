import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString: string, opts: { max?: number } = {}) {
  const client = postgres(connectionString, {
    max: opts.max ?? 10,
    prepare: false,
  });
  return drizzle(client, { schema, casing: "snake_case" });
}
