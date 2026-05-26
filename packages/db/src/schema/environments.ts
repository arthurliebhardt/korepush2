import { pgTable, text, timestamp, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { projects } from "./projects.js";

export const environments = pgTable(
  "environments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // production | staging | preview
    type: text("type").notNull().default("production"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    namespace: text("namespace").notNull(),
    branch: text("branch"),
    pullRequestNumber: integer("pull_request_number"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("environments_project_slug_unique").on(t.projectId, t.slug),
    uniqueIndex("environments_namespace_unique").on(t.namespace),
  ],
);
