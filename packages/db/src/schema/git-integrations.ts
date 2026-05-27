import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { teams } from "./teams.js";
import { user } from "./auth.js";

/**
 * A GitHub App that this team has connected. We use the GitHub App "manifest
 * flow" so every self-hosted Korepush instance creates its own private App on
 * the operator's account — no shared client_id, no central credentials.
 *
 * Lifecycle:
 *  1. Operator clicks "Connect GitHub" → we redirect to GitHub with a manifest.
 *  2. GitHub creates the App and redirects back with a temporary code.
 *  3. /api/integrations/github/callback exchanges the code for the App's
 *     credentials (id, slug, client_secret, webhook_secret, private key) which
 *     we encrypt and store here. installation_id is still null at this point.
 *  4. Operator is redirected to <html_url>/installations/new and picks which
 *     repos to grant access to.
 *  5. GitHub redirects to /api/integrations/github/installed with the
 *     installation_id, which we save here.
 */
export const gitIntegrations = pgTable(
  "git_integrations",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    // github | gitlab | bitbucket — only github supported for MVP
    provider: text("provider").notNull().default("github"),

    // GitHub App identity (filled by /callback after manifest exchange)
    appId: text("app_id"),
    appSlug: text("app_slug"),
    appName: text("app_name"),
    htmlUrl: text("html_url"),
    clientId: text("client_id"),
    clientSecretEncrypted: text("client_secret_encrypted"),
    privateKeyEncrypted: text("private_key_encrypted"),
    webhookSecretEncrypted: text("webhook_secret_encrypted"),

    // Installation (filled by /installed after the operator picks repos)
    installationId: text("installation_id"),
    installationAccountLogin: text("installation_account_login"),
    installationAccountType: text("installation_account_type"), // User | Organization

    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One integration per (team, provider) for v1. Multi-account support
    // can extend this later with a label/name column.
    uniqueIndex("git_integrations_team_provider_unique").on(
      t.teamId,
      t.provider,
    ),
    index("git_integrations_installation_idx").on(t.installationId),
  ],
);
