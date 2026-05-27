CREATE TABLE "git_integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"app_id" text,
	"app_slug" text,
	"app_name" text,
	"html_url" text,
	"client_id" text,
	"client_secret_encrypted" text,
	"private_key_encrypted" text,
	"webhook_secret_encrypted" text,
	"installation_id" text,
	"installation_account_login" text,
	"installation_account_type" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "git_integrations" ADD CONSTRAINT "git_integrations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_integrations" ADD CONSTRAINT "git_integrations_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "git_integrations_team_provider_unique" ON "git_integrations" USING btree ("team_id","provider");--> statement-breakpoint
CREATE INDEX "git_integrations_installation_idx" ON "git_integrations" USING btree ("installation_id");