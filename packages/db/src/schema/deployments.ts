import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { projects } from "./projects.js";
import { environments } from "./environments.js";
import { user } from "./auth.js";

export const deployments = pgTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    // queued | building | deploying | ready | failed | cancelled | rolled_back
    status: text("status").notNull().default("queued"),
    // manual | webhook | rollback
    source: text("source").notNull().default("manual"),

    commitSha: text("commit_sha"),
    commitMessage: text("commit_message"),
    gitRef: text("git_ref"),

    imageRepository: text("image_repository"),
    imageTag: text("image_tag"),
    imageDigest: text("image_digest"),

    dockerfilePath: text("dockerfile_path").notNull(),
    buildContext: text("build_context").notNull(),
    buildTarget: text("build_target"),

    buildStartedAt: timestamp("build_started_at", { withTimezone: true }),
    buildFinishedAt: timestamp("build_finished_at", { withTimezone: true }),
    deployedAt: timestamp("deployed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),

    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    rollbackFromDeploymentId: text("rollback_from_deployment_id").references(
      (): AnyPgColumn => deployments.id,
      { onDelete: "set null" },
    ),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("deployments_project_idx").on(t.projectId, t.createdAt),
    index("deployments_environment_idx").on(t.environmentId, t.createdAt),
    index("deployments_status_idx").on(t.status),
  ],
);

export const deploymentEvents = pgTable(
  "deployment_events",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deployment_events_deployment_idx").on(t.deploymentId, t.createdAt)],
);

export const buildLogs = pgTable(
  "build_logs",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    seq: text("seq").notNull(),
    stream: text("stream").notNull().default("stdout"),
    line: text("line").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("build_logs_deployment_idx").on(t.deploymentId, t.seq)],
);
