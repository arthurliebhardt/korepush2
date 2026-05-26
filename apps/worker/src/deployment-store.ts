import { eq } from "drizzle-orm";
import { schema, type Database } from "@korepush/db";
import type { DeploymentStatus } from "@korepush/shared";
import { newId } from "@korepush/queue";

export async function updateDeployment(
  db: Database,
  deploymentId: string,
  patch: Partial<typeof schema.deployments.$inferInsert>,
): Promise<void> {
  await db
    .update(schema.deployments)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.deployments.id, deploymentId));
}

export async function setStatus(
  db: Database,
  deploymentId: string,
  status: DeploymentStatus,
  extra?: Partial<typeof schema.deployments.$inferInsert>,
): Promise<void> {
  const patch: Partial<typeof schema.deployments.$inferInsert> = { status, ...extra };
  if (status === "building" && !extra?.buildStartedAt) patch.buildStartedAt = new Date();
  if ((status === "deploying" || status === "failed") && !extra?.buildFinishedAt) {
    patch.buildFinishedAt = new Date();
  }
  if (status === "ready" && !extra?.deployedAt) patch.deployedAt = new Date();
  if (status === "failed" && !extra?.failedAt) patch.failedAt = new Date();
  await updateDeployment(db, deploymentId, patch);
}

export async function recordEvent(
  db: Database,
  deploymentId: string,
  type: string,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db.insert(schema.deploymentEvents).values({
    id: newId("depev"),
    deploymentId,
    type,
    message,
    metadata: metadata ?? null,
  });
}

export async function appendBuildLogs(
  db: Database,
  deploymentId: string,
  text: string,
  stream: "stdout" | "stderr" = "stdout",
): Promise<void> {
  if (!text) return;
  const lines = text.split("\n");
  const rows = lines
    .map((line, i) => ({
      id: newId("bl"),
      deploymentId,
      seq: padSeq(Date.now(), i),
      stream,
      line,
    }))
    .filter((r) => r.line.length > 0);
  if (rows.length === 0) return;
  // Chunk to avoid huge INSERTs.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(schema.buildLogs).values(rows.slice(i, i + CHUNK));
  }
}

function padSeq(ts: number, idx: number): string {
  return `${ts.toString().padStart(15, "0")}-${idx.toString().padStart(6, "0")}`;
}
