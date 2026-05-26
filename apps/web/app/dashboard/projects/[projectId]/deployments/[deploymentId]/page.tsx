import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, CodeBlock, StatusDot } from "@korepush/ui";
import { db } from "@/lib/db";
import { requireDeployment } from "@/lib/access";
import { schema } from "@korepush/db";
import { RollbackButton } from "./rollback-button";

export const dynamic = "force-dynamic";

export default async function DeploymentDetail({
  params,
}: {
  params: Promise<{ projectId: string; deploymentId: string }>;
}) {
  const { deploymentId } = await params;
  let ctx;
  try {
    ctx = await requireDeployment(deploymentId);
  } catch {
    notFound();
  }
  const { deployment } = ctx;

  const [events, logs] = await Promise.all([
    db.query.deploymentEvents.findMany({
      where: eq(schema.deploymentEvents.deploymentId, deployment.id),
      orderBy: desc(schema.deploymentEvents.createdAt),
      limit: 200,
    }),
    db.query.buildLogs.findMany({
      where: eq(schema.buildLogs.deploymentId, deployment.id),
      orderBy: (l, { asc }) => asc(l.seq),
      limit: 2000,
    }),
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2">
              <Badge tone="neutral" className="inline-flex items-center gap-1.5">
                <StatusDot status={deployment.status} />
                {deployment.status}
              </Badge>
              <span className="font-mono text-xs text-zinc-500">{deployment.id}</span>
            </CardTitle>
            {deployment.status === "ready" ? (
              <RollbackButton deploymentId={deployment.id} />
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {deployment.failureReason ? (
            <p className="text-red-600">{deployment.failureReason}</p>
          ) : null}
          <p>
            <span className="text-zinc-500">Source:</span> {deployment.source}
          </p>
          {deployment.commitSha ? (
            <p>
              <span className="text-zinc-500">Commit:</span>{" "}
              <span className="font-mono">{deployment.commitSha}</span>
            </p>
          ) : null}
          {deployment.imageDigest ? (
            <p className="break-all">
              <span className="text-zinc-500">Image:</span>{" "}
              <span className="font-mono text-xs">{deployment.imageDigest}</span>
            </p>
          ) : null}
          <p>
            <span className="text-zinc-500">Dockerfile:</span>{" "}
            <span className="font-mono">{deployment.dockerfilePath}</span>
          </p>
          <p>
            <span className="text-zinc-500">Context:</span>{" "}
            <span className="font-mono">{deployment.buildContext}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-zinc-500">No events yet.</p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="text-xs text-zinc-500 font-mono w-44 shrink-0">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                  <span className="font-medium text-xs text-zinc-700 dark:text-zinc-300 w-32 shrink-0">
                    {e.type}
                  </span>
                  <span className="text-zinc-700 dark:text-zinc-300">{e.message}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Build logs</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-zinc-500">No logs yet.</p>
          ) : (
            <CodeBlock>{logs.map((l) => l.line).join("\n")}</CodeBlock>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
