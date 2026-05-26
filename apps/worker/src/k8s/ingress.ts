import type { Apis } from "./client.js";
import { commonLabels, type LabelInput } from "@korepush/shared";
import { isAlreadyExists, isNotFound } from "./apply.js";

export interface IngressArgs {
  namespace: string;
  name: string;
  serviceName: string;
  hostnames: string[];
  ingressClass: string;
  certIssuer?: string | null;
  labels: LabelInput;
}

export function buildIngressManifest(args: IngressArgs) {
  const annotations: Record<string, string> = {};
  if (args.certIssuer) {
    annotations["cert-manager.io/cluster-issuer"] = args.certIssuer;
  }
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: {
      name: args.name,
      namespace: args.namespace,
      labels: commonLabels(args.labels),
      annotations,
    },
    spec: {
      ingressClassName: args.ingressClass,
      rules: args.hostnames.map((host) => ({
        host,
        http: {
          paths: [
            {
              path: "/",
              pathType: "Prefix",
              backend: { service: { name: args.serviceName, port: { number: 80 } } },
            },
          ],
        },
      })),
      tls: args.certIssuer && args.hostnames.length > 0
        ? [{ hosts: args.hostnames, secretName: `${args.name}-tls` }]
        : undefined,
    },
  };
}

export async function applyIngress(apis: Apis, manifest: ReturnType<typeof buildIngressManifest>) {
  try {
    await apis.networking.createNamespacedIngress({
      namespace: manifest.metadata.namespace,
      body: manifest,
    });
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    await apis.networking.replaceNamespacedIngress({
      namespace: manifest.metadata.namespace,
      name: manifest.metadata.name,
      body: manifest,
    });
  }
}

export async function deleteIngress(apis: Apis, namespace: string, name: string) {
  try {
    await apis.networking.deleteNamespacedIngress({ namespace, name });
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}
