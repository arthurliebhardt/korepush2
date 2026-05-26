CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clusters" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'registered' NOT NULL,
	"kubeconfig_encrypted" text,
	"default_registry_url" text,
	"default_ingress_class" text DEFAULT 'traefik' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"cluster_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"git_provider" text DEFAULT 'generic' NOT NULL,
	"git_repo_url" text NOT NULL,
	"git_default_branch" text DEFAULT 'main' NOT NULL,
	"build_mode" text DEFAULT 'dockerfile' NOT NULL,
	"dockerfile_path" text DEFAULT 'Dockerfile' NOT NULL,
	"build_context" text DEFAULT '.' NOT NULL,
	"build_target" text,
	"port" integer DEFAULT 3000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"type" text DEFAULT 'production' NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"namespace" text NOT NULL,
	"branch" text,
	"pull_request_number" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"seq" text NOT NULL,
	"stream" text DEFAULT 'stdout' NOT NULL,
	"line" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"commit_sha" text,
	"commit_message" text,
	"git_ref" text,
	"image_repository" text,
	"image_tag" text,
	"image_digest" text,
	"dockerfile_path" text NOT NULL,
	"build_context" text NOT NULL,
	"build_target" text,
	"build_started_at" timestamp with time zone,
	"build_finished_at" timestamp with time zone,
	"deployed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"created_by_user_id" text,
	"rollback_from_deployment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"hostname" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"tls_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "env_vars" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"key" text NOT NULL,
	"value_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload" jsonb NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"visibility_timeout_at" timestamp with time zone,
	"idempotency_key" text,
	"dedupe_key" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "k8s_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"cluster_id" text NOT NULL,
	"project_id" text,
	"environment_id" text,
	"deployment_id" text,
	"api_version" text NOT NULL,
	"kind" text NOT NULL,
	"namespace" text NOT NULL,
	"name" text NOT NULL,
	"labels" jsonb,
	"annotations" jsonb,
	"manifest" jsonb NOT NULL,
	"spec_hash" text NOT NULL,
	"applied_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_logs" ADD CONSTRAINT "build_logs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_events" ADD CONSTRAINT "deployment_events_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_rollback_from_deployment_id_deployments_id_fk" FOREIGN KEY ("rollback_from_deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_vars" ADD CONSTRAINT "env_vars_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_vars" ADD CONSTRAINT "env_vars_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k8s_resources" ADD CONSTRAINT "k8s_resources_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k8s_resources" ADD CONSTRAINT "k8s_resources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k8s_resources" ADD CONSTRAINT "k8s_resources_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k8s_resources" ADD CONSTRAINT "k8s_resources_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_user_unique" ON "team_members" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_slug_unique" ON "teams" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "clusters_team_slug_unique" ON "clusters" USING btree ("team_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_team_slug_unique" ON "projects" USING btree ("team_id","slug");--> statement-breakpoint
CREATE INDEX "projects_team_idx" ON "projects" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_project_slug_unique" ON "environments" USING btree ("project_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_namespace_unique" ON "environments" USING btree ("namespace");--> statement-breakpoint
CREATE INDEX "build_logs_deployment_idx" ON "build_logs" USING btree ("deployment_id","seq");--> statement-breakpoint
CREATE INDEX "deployment_events_deployment_idx" ON "deployment_events" USING btree ("deployment_id","created_at");--> statement-breakpoint
CREATE INDEX "deployments_project_idx" ON "deployments" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "deployments_environment_idx" ON "deployments" USING btree ("environment_id","created_at");--> statement-breakpoint
CREATE INDEX "deployments_status_idx" ON "deployments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_hostname_unique" ON "domains" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "domains_project_idx" ON "domains" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "domains_env_idx" ON "domains" USING btree ("environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "env_vars_env_key_unique" ON "env_vars" USING btree ("environment_id","key");--> statement-breakpoint
CREATE INDEX "job_events_job_idx" ON "job_events" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_unique" ON "jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_at","priority");--> statement-breakpoint
CREATE INDEX "jobs_dedupe_idx" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "jobs_kind_idx" ON "jobs" USING btree ("kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "k8s_resources_identity_unique" ON "k8s_resources" USING btree ("cluster_id","api_version","kind","namespace","name");--> statement-breakpoint
CREATE INDEX "k8s_resources_project_idx" ON "k8s_resources" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "k8s_resources_env_idx" ON "k8s_resources" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "k8s_resources_deployment_idx" ON "k8s_resources" USING btree ("deployment_id");