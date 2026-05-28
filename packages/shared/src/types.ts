import type {
  BUILD_MODES,
  CLUSTER_STATUSES,
  DEPLOYMENT_SOURCES,
  DEPLOYMENT_STATUSES,
  DOMAIN_TLS_STATUSES,
  DOMAIN_VERIFICATION_STATUSES,
  ENVIRONMENT_TYPES,
  JOB_KINDS,
  JOB_STATUSES,
  TEAM_ROLES,
} from "./constants.js";

export type BuildMode = (typeof BUILD_MODES)[number];
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];
export type DeploymentSource = (typeof DEPLOYMENT_SOURCES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobKind = (typeof JOB_KINDS)[number];
export type EnvironmentType = (typeof ENVIRONMENT_TYPES)[number];
export type DomainVerificationStatus = (typeof DOMAIN_VERIFICATION_STATUSES)[number];
export type DomainTlsStatus = (typeof DOMAIN_TLS_STATUSES)[number];
export type ClusterStatus = (typeof CLUSTER_STATUSES)[number];
export type TeamRole = (typeof TEAM_ROLES)[number];

export interface DeployProjectPayload {
  projectId: string;
  environmentId: string;
  deploymentId: string;
  createdByUserId: string | null;
  gitRef: string;
  commitSha: string | null;
}

export interface RollbackDeploymentPayload {
  targetDeploymentId: string;
  newDeploymentId: string;
  createdByUserId: string | null;
}

export interface DeleteProjectPayload {
  projectId: string;
}

export interface SyncDomainPayload {
  domainId: string;
}

export type JobPayloadMap = {
  "deploy.project": DeployProjectPayload;
  "rollback.deployment": RollbackDeploymentPayload;
  "delete.project": DeleteProjectPayload;
  "sync.domain": SyncDomainPayload;
};

export type JobPayloadFor<K extends JobKind> = JobPayloadMap[K];
