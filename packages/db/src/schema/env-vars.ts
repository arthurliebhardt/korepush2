import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { projects } from "./projects.js";
import { environments } from "./environments.js";

export const envVars = pgTable(
  "env_vars",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    valueEncrypted: text("value_encrypted").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("env_vars_env_key_unique").on(t.environmentId, t.key)],
);
