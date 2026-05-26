import { createDb } from "@korepush/db";
import { env } from "./env.js";

export const db = createDb(env.databaseUrl);
