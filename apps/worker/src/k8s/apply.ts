import { createHash } from "node:crypto";
import { schema } from "@korepush/db";
import { sql } from "drizzle-orm";
import type { Database } from "@korepush/db";
import { newId } from "@korepush/queue";

export interface ManagedResource {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace: string; labels?: Record<string, string> };
  // spec / other fields
  [key: string]: unknown;
}

export interface TrackOptions {
  db: Database;
  clusterId: string;
  projectId?: string | null;
  environmentId?: string | null;
  deploymentId?: string | null;
}

/**
 * Record (or update) a managed Kubernetes resource in k8s_resources with a
 * stable spec hash for change detection. Should be called after a successful apply.
 */
export async function trackResource(
  resource: ManagedResource,
  opts: TrackOptions,
): Promise<void> {
  const specHash = hashManifest(resource);
  await opts.db
    .insert(schema.k8sResources)
    .values({
      id: newId("k8s"),
      clusterId: opts.clusterId,
      projectId: opts.projectId ?? null,
      environmentId: opts.environmentId ?? null,
      deploymentId: opts.deploymentId ?? null,
      apiVersion: resource.apiVersion,
      kind: resource.kind,
      namespace: resource.metadata.namespace,
      name: resource.metadata.name,
      labels: resource.metadata.labels ?? null,
      annotations: null,
      manifest: resource as unknown as Record<string, unknown>,
      specHash,
      appliedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.k8sResources.clusterId,
        schema.k8sResources.apiVersion,
        schema.k8sResources.kind,
        schema.k8sResources.namespace,
        schema.k8sResources.name,
      ],
      set: {
        manifest: resource as unknown as Record<string, unknown>,
        labels: resource.metadata.labels ?? null,
        specHash,
        appliedAt: new Date(),
        deletedAt: null,
        deploymentId: opts.deploymentId ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function markResourceDeleted(
  db: Database,
  clusterId: string,
  apiVersion: string,
  kind: string,
  namespace: string,
  name: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE k8s_resources
    SET deleted_at = now(), updated_at = now()
    WHERE cluster_id = ${clusterId}
      AND api_version = ${apiVersion}
      AND kind = ${kind}
      AND namespace = ${namespace}
      AND name = ${name}
  `);
}

function hashManifest(obj: unknown): string {
  return createHash("sha256")
    .update(stableStringify(obj))
    .digest("hex");
}

function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

/**
 * Check if a Kubernetes API error indicates the resource doesn't exist.
 */
export function isNotFound(err: unknown): boolean {
  const e = err as { code?: number; statusCode?: number; response?: { statusCode?: number } };
  return e?.code === 404 || e?.statusCode === 404 || e?.response?.statusCode === 404;
}

export function isConflict(err: unknown): boolean {
  const e = err as { code?: number; statusCode?: number; response?: { statusCode?: number } };
  return e?.code === 409 || e?.statusCode === 409 || e?.response?.statusCode === 409;
}

export function isAlreadyExists(err: unknown): boolean {
  return isConflict(err);
}
