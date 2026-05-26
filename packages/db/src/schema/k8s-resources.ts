import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { clusters } from "./clusters.js";
import { projects } from "./projects.js";
import { environments } from "./environments.js";
import { deployments } from "./deployments.js";

export const k8sResources = pgTable(
  "k8s_resources",
  {
    id: text("id").primaryKey(),
    clusterId: text("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    environmentId: text("environment_id").references(() => environments.id, {
      onDelete: "cascade",
    }),
    deploymentId: text("deployment_id").references(() => deployments.id, {
      onDelete: "set null",
    }),

    apiVersion: text("api_version").notNull(),
    kind: text("kind").notNull(),
    namespace: text("namespace").notNull(),
    name: text("name").notNull(),

    labels: jsonb("labels"),
    annotations: jsonb("annotations"),
    manifest: jsonb("manifest").notNull(),
    specHash: text("spec_hash").notNull(),

    appliedAt: timestamp("applied_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("k8s_resources_identity_unique").on(
      t.clusterId,
      t.apiVersion,
      t.kind,
      t.namespace,
      t.name,
    ),
    index("k8s_resources_project_idx").on(t.projectId),
    index("k8s_resources_env_idx").on(t.environmentId),
    index("k8s_resources_deployment_idx").on(t.deploymentId),
  ],
);
