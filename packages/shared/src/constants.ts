export const PLATFORM_NAMESPACE = "korepush-system" as const;
export const LABEL_PREFIX = "korepush.dev" as const;
export const MANAGED_BY = "korepush" as const;

export const DEFAULT_PORT = 3000;
export const DEFAULT_BRANCH = "main";
export const DEFAULT_DOCKERFILE_PATH = "Dockerfile";
export const DEFAULT_BUILD_CONTEXT = ".";

export const DEFAULT_CPU_REQUEST = "100m";
export const DEFAULT_MEMORY_REQUEST = "128Mi";
export const DEFAULT_CPU_LIMIT = "500m";
export const DEFAULT_MEMORY_LIMIT = "512Mi";

export const SETUP_TOKEN_TTL_HOURS = 24;
export const JOB_DEFAULT_MAX_ATTEMPTS = 3;
export const JOB_DEFAULT_VISIBILITY_SECONDS = 300;
export const ROLLOUT_TIMEOUT_SECONDS = 600;
export const BUILD_TIMEOUT_SECONDS = 1800;

export const DEPLOYMENT_STATUSES = [
  "queued",
  "building",
  "deploying",
  "ready",
  "failed",
  "cancelled",
  "rolled_back",
] as const;

export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export const JOB_KINDS = [
  "deploy.project",
  "rollback.deployment",
  "delete.project",
  "sync.domain",
] as const;

export const DEPLOYMENT_SOURCES = ["manual", "webhook", "rollback"] as const;

export const ENVIRONMENT_TYPES = ["production", "staging", "preview"] as const;

export const DOMAIN_VERIFICATION_STATUSES = ["pending", "verified", "failed"] as const;
export const DOMAIN_TLS_STATUSES = ["pending", "issuing", "active", "failed", "disabled"] as const;

export const CLUSTER_STATUSES = ["registered", "healthy", "degraded", "offline"] as const;

export const TEAM_ROLES = ["owner", "admin", "member"] as const;

export const BUILD_MODES = ["dockerfile", "nixpacks"] as const;
export type BuildMode = (typeof BUILD_MODES)[number];
