import { pgTable, text, timestamp, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { projects } from "./projects.js";
import { environments } from "./environments.js";

export const domains = pgTable(
  "domains",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    // pending | verified | failed
    verificationStatus: text("verification_status").notNull().default("pending"),
    // pending | issuing | active | failed | disabled
    tlsStatus: text("tls_status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("domains_hostname_unique").on(t.hostname),
    index("domains_project_idx").on(t.projectId),
    index("domains_env_idx").on(t.environmentId),
  ],
);
