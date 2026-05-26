export interface ProjectEnvCoords {
  projectSlug: string;
  environmentSlug: string;
  environmentType?: string;
  pullRequestNumber?: number | null;
}

export function namespaceName(coords: ProjectEnvCoords): string {
  const { projectSlug, environmentSlug, environmentType, pullRequestNumber } = coords;

  if (environmentType === "preview" && pullRequestNumber != null) {
    return `p-${projectSlug}-pr-${pullRequestNumber}`;
  }

  const envPart =
    environmentSlug === "production"
      ? "prod"
      : environmentSlug === "staging"
        ? "staging"
        : environmentSlug;

  return `p-${projectSlug}-${envPart}`;
}

export function deploymentName(projectSlug: string): string {
  return `${projectSlug}-web`;
}

export function serviceName(projectSlug: string): string {
  return `${projectSlug}-web`;
}

export function ingressName(projectSlug: string): string {
  return `${projectSlug}-web`;
}

export function envSecretName(projectSlug: string): string {
  return `${projectSlug}-env`;
}

export function buildJobName(deploymentId: string): string {
  const short = deploymentId.replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase();
  return `build-${short}`;
}

export function imageRepository(registryUrl: string, projectSlug: string): string {
  const host = registryUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `${host}/${projectSlug}`;
}

export function imageTag(deploymentId: string): string {
  return `deploy-${deploymentId.replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase()}`;
}
