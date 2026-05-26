import { LABEL_PREFIX, MANAGED_BY } from "./constants.js";

export interface LabelInput {
  projectId: string;
  projectSlug: string;
  environmentId: string;
  environmentSlug: string;
  deploymentId?: string;
  component: "web" | "build" | "worker" | "system";
}

export function commonLabels(input: LabelInput): Record<string, string> {
  const labels: Record<string, string> = {
    "app.kubernetes.io/name": input.projectSlug,
    "app.kubernetes.io/instance": input.environmentSlug,
    "app.kubernetes.io/component": input.component,
    "app.kubernetes.io/part-of": input.projectSlug,
    "app.kubernetes.io/managed-by": MANAGED_BY,
    [`${LABEL_PREFIX}/project-id`]: input.projectId,
    [`${LABEL_PREFIX}/environment-id`]: input.environmentId,
  };

  if (input.deploymentId) {
    labels[`${LABEL_PREFIX}/deployment-id`] = input.deploymentId;
  }

  return labels;
}

export function selectorLabels(input: Pick<LabelInput, "projectSlug" | "environmentSlug" | "component">): Record<string, string> {
  return {
    "app.kubernetes.io/name": input.projectSlug,
    "app.kubernetes.io/instance": input.environmentSlug,
    "app.kubernetes.io/component": input.component,
  };
}

export function projectLabelSelector(projectId: string): string {
  return `${LABEL_PREFIX}/project-id=${projectId}`;
}

export function environmentLabelSelector(environmentId: string): string {
  return `${LABEL_PREFIX}/environment-id=${environmentId}`;
}

export function deploymentLabelSelector(deploymentId: string): string {
  return `${LABEL_PREFIX}/deployment-id=${deploymentId}`;
}
