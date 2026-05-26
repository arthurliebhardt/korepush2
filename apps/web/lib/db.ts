import { createDb } from "@korepush/db";
import { env } from "./env.js";

// Reuse the same connection across HMR hot reloads in dev.
const g = globalThis as unknown as { __korepushDb?: ReturnType<typeof createDb> };

export const db = g.__korepushDb ?? createDb(env.databaseUrl);
if (process.env.NODE_ENV !== "production") g.__korepushDb = db;
