import { pgTable, text, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { teams } from "./teams.js";
import { clusters } from "./clusters.js";

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    clusterId: text("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // github | gitlab | bitbucket | generic
    gitProvider: text("git_provider").notNull().default("generic"),
    gitRepoUrl: text("git_repo_url").notNull(),
    gitDefaultBranch: text("git_default_branch").notNull().default("main"),
    // MVP: dockerfile
    buildMode: text("build_mode").notNull().default("dockerfile"),
    dockerfilePath: text("dockerfile_path").notNull().default("Dockerfile"),
    buildContext: text("build_context").notNull().default("."),
    buildTarget: text("build_target"),
    port: integer("port").notNull().default(3000),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("projects_team_slug_unique").on(t.teamId, t.slug),
    index("projects_team_idx").on(t.teamId),
  ],
);
