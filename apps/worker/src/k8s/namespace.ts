import type { Apis } from "./client.js";
import { isAlreadyExists } from "./apply.js";
import { commonLabels, type LabelInput } from "@korepush/shared";

export async function ensureNamespace(
  apis: Apis,
  name: string,
  labels: LabelInput,
): Promise<void> {
  try {
    await apis.core.createNamespace({
      body: {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: {
          name,
          labels: commonLabels(labels),
        },
      },
    });
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    // Already exists. Labels diverging is acceptable for MVP — we don't try to
    // reconcile namespace metadata once created.
  }
}
