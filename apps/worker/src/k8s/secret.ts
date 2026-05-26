import type { Apis } from "./client.js";
import { isAlreadyExists, isNotFound } from "./apply.js";
import { commonLabels, type LabelInput } from "@korepush/shared";

export async function applyEnvSecret(
  apis: Apis,
  args: {
    namespace: string;
    name: string;
    data: Record<string, string>;
    labels: LabelInput;
  },
): Promise<void> {
  // K8s expects base64 in `data`, or plaintext in `stringData`. We use stringData.
  const body = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: args.name,
      namespace: args.namespace,
      labels: commonLabels(args.labels),
    },
    type: "Opaque",
    stringData: args.data,
  };

  try {
    await apis.core.createNamespacedSecret({ namespace: args.namespace, body });
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    await apis.core.replaceNamespacedSecret({
      namespace: args.namespace,
      name: args.name,
      body,
    });
  }
}

export async function deleteSecret(
  apis: Apis,
  namespace: string,
  name: string,
): Promise<void> {
  try {
    await apis.core.deleteNamespacedSecret({ namespace, name });
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}
