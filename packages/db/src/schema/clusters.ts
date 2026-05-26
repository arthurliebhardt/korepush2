import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { teams } from "./teams.js";

export const clusters = pgTable(
  "clusters",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // registered | healthy | degraded | offline
    status: text("status").notNull().default("registered"),
    // Encrypted kubeconfig blob. NULL for in-cluster (default local cluster).
    kubeconfigEncrypted: text("kubeconfig_encrypted"),
    defaultRegistryUrl: text("default_registry_url"),
    defaultIngressClass: text("default_ingress_class").notNull().default("traefik"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("clusters_team_slug_unique").on(t.teamId, t.slug)],
);
