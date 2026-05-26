import type { Apis } from "./client.js";
import {
  commonLabels,
  DEFAULT_CPU_LIMIT,
  DEFAULT_CPU_REQUEST,
  DEFAULT_MEMORY_LIMIT,
  DEFAULT_MEMORY_REQUEST,
  selectorLabels,
  type LabelInput,
} from "@korepush/shared";
import { isAlreadyExists } from "./apply.js";

export interface DeploymentArgs {
  namespace: string;
  name: string;
  image: string;
  port: number;
  envSecretName: string;
  labels: LabelInput;
  replicas?: number;
}

export function buildDeploymentManifest(args: DeploymentArgs) {
  const labels = commonLabels(args.labels);
  const selector = selectorLabels({
    projectSlug: args.labels.projectSlug,
    environmentSlug: args.labels.environmentSlug,
    component: args.labels.component,
  });

  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: args.name, namespace: args.namespace, labels },
    spec: {
      replicas: args.replicas ?? 1,
      revisionHistoryLimit: 5,
      selector: { matchLabels: selector },
      strategy: {
        type: "RollingUpdate",
        rollingUpdate: { maxSurge: 1, maxUnavailable: 0 },
      },
      template: {
        metadata: { labels },
        spec: {
          containers: [
            {
              name: "app",
              image: args.image,
              imagePullPolicy: "IfNotPresent",
              ports: [{ name: "http", containerPort: args.port, protocol: "TCP" }],
              envFrom: [{ secretRef: { name: args.envSecretName, optional: true } }],
              env: [{ name: "PORT", value: String(args.port) }],
              resources: {
                requests: { cpu: DEFAULT_CPU_REQUEST, memory: DEFAULT_MEMORY_REQUEST },
                limits: { cpu: DEFAULT_CPU_LIMIT, memory: DEFAULT_MEMORY_LIMIT },
              },
              readinessProbe: {
                tcpSocket: { port: args.port },
                initialDelaySeconds: 2,
                periodSeconds: 5,
                failureThreshold: 6,
              },
              livenessProbe: {
                tcpSocket: { port: args.port },
                initialDelaySeconds: 30,
                periodSeconds: 10,
                failureThreshold: 6,
              },
            },
          ],
          terminationGracePeriodSeconds: 30,
        },
      },
    },
  };
}

export async function applyDeployment(apis: Apis, manifest: ReturnType<typeof buildDeploymentManifest>) {
  try {
    await apis.apps.createNamespacedDeployment({
      namespace: manifest.metadata.namespace,
      body: manifest,
    });
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    await apis.apps.replaceNamespacedDeployment({
      namespace: manifest.metadata.namespace,
      name: manifest.metadata.name,
      body: manifest,
    });
  }
}

/**
 * Update only the container image on an existing Deployment. Used by rollback.
 * If the Deployment doesn't exist (e.g., resources have been cleaned up),
 * the caller should fall back to applyDeployment with a full manifest.
 */
export async function patchDeploymentImage(
  apis: Apis,
  args: { namespace: string; name: string; image: string },
): Promise<boolean> {
  const dep = await apis.apps.readNamespacedDeployment({
    namespace: args.namespace,
    name: args.name,
  });
  if (!dep.spec?.template?.spec?.containers?.[0]) return false;
  dep.spec.template.spec.containers[0].image = args.image;
  await apis.apps.replaceNamespacedDeployment({
    namespace: args.namespace,
    name: args.name,
    body: dep,
  });
  return true;
}
