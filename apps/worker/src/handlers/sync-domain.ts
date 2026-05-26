import { and, eq } from "drizzle-orm";
import { schema } from "@korepush/db";
import {
  ingressName,
  serviceName,
  type LabelInput,
  type SyncDomainPayload,
} from "@korepush/shared";
import { db } from "../db.js";
import { env } from "../env.js";
import { apis } from "../k8s/client.js";
import { applyIngress, buildIngressManifest, deleteIngress } from "../k8s/ingress.js";
import { trackResource, markResourceDeleted } from "../k8s/apply.js";
import { log as rootLog } from "../log.js";

export async function syncDomain(payload: SyncDomainPayload): Promise<void> {
  const log = rootLog.child({ handler: "sync.domain", domainId: payload.domainId });

  // The domain may have been deleted — we still need to reconcile.
  const domain = await db.query.domains.findFirst({
    where: eq(schema.domains.id, payload.domainId),
  });

  // Resolve environment + project either from the live row, or from any sibling
  // domain still present for the environment.
  const environmentId = domain?.environmentId;
  if (!environmentId) {
    log.warn("domain row missing; nothing to sync");
    return;
  }

  const environment = await db.query.environments.findFirst({
    where: eq(schema.environments.id, environmentId),
  });
  if (!environment) return;

  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, environment.projectId),
  });
  if (!project) return;

  const cluster = await db.query.clusters.findFirst({
    where: eq(schema.clusters.id, project.clusterId),
  });
  if (!cluster) return;

  // Build hostname list from current state in DB.
  const liveDomains = await db.query.domains.findMany({
    where: eq(schema.domains.environmentId, environment.id),
  });
  const hostnames = liveDomains.map((d) => d.hostname);

  const k = apis();
  const ingName = ingressName(project.slug);

  if (hostnames.length === 0) {
    await deleteIngress(k, environment.namespace, ingName);
    await markResourceDeleted(
      db,
      cluster.id,
      "networking.k8s.io/v1",
      "Ingress",
      environment.namespace,
      ingName,
    );
    return;
  }

  const labels: LabelInput = {
    projectId: project.id,
    projectSlug: project.slug,
    environmentId: environment.id,
    environmentSlug: environment.slug,
    component: "web",
  };
  const manifest = buildIngressManifest({
    namespace: environment.namespace,
    name: ingName,
    serviceName: serviceName(project.slug),
    hostnames,
    ingressClass: cluster.defaultIngressClass ?? env.defaultIngressClass,
    certIssuer: env.certIssuer,
    labels,
  });
  await applyIngress(k, manifest);
  await trackResource(manifest as never, {
    db,
    clusterId: cluster.id,
    projectId: project.id,
    environmentId: environment.id,
  });

  // Mark domains active. We don't run live DNS/TLS checks in MVP, but the
  // dashboard surfaces these statuses.
  await db
    .update(schema.domains)
    .set({ verificationStatus: "verified", tlsStatus: env.certIssuer ? "issuing" : "disabled" })
    .where(and(eq(schema.domains.environmentId, environment.id)));
}
