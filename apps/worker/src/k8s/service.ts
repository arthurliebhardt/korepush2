import type { Apis } from "./client.js";
import { commonLabels, selectorLabels, type LabelInput } from "@korepush/shared";
import { isAlreadyExists } from "./apply.js";

export interface ServiceArgs {
  namespace: string;
  name: string;
  port: number;
  labels: LabelInput;
}

export function buildServiceManifest(args: ServiceArgs) {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: args.name, namespace: args.namespace, labels: commonLabels(args.labels) },
    spec: {
      type: "ClusterIP",
      selector: selectorLabels({
        projectSlug: args.labels.projectSlug,
        environmentSlug: args.labels.environmentSlug,
        component: args.labels.component,
      }),
      ports: [{ name: "http", port: 80, targetPort: args.port, protocol: "TCP" }],
    },
  };
}

export async function applyService(apis: Apis, manifest: ReturnType<typeof buildServiceManifest>) {
  try {
    await apis.core.createNamespacedService({
      namespace: manifest.metadata.namespace,
      body: manifest,
    });
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    // Replacing a Service requires preserving the clusterIP. Fetch + merge.
    const current = await apis.core.readNamespacedService({
      namespace: manifest.metadata.namespace,
      name: manifest.metadata.name,
    });
    const merged = {
      ...manifest,
      metadata: { ...manifest.metadata, resourceVersion: current.metadata?.resourceVersion },
      spec: {
        ...manifest.spec,
        clusterIP: current.spec?.clusterIP,
        clusterIPs: current.spec?.clusterIPs,
      },
    };
    await apis.core.replaceNamespacedService({
      namespace: manifest.metadata.namespace,
      name: manifest.metadata.name,
      body: merged,
    });
  }
}
