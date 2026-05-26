import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Badge, Card, CardContent, EmptyState, StatusDot } from "@korepush/ui";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/access";
import { schema } from "@korepush/db";

export const dynamic = "force-dynamic";

export default async function DeploymentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProject(projectId);

  const deployments = await db.query.deployments.findMany({
    where: eq(schema.deployments.projectId, projectId),
    orderBy: desc(schema.deployments.createdAt),
    limit: 100,
  });

  if (deployments.length === 0) {
    return <EmptyState title="No deployments yet" description="Click Deploy on the overview tab to create one." />;
  }

  return (
    <div className="space-y-2">
      {deployments.map((d) => (
        <Link key={d.id} href={`/dashboard/projects/${projectId}/deployments/${d.id}`}>
          <Card className="hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral" className="inline-flex items-center gap-1.5">
                      <StatusDot status={d.status} />
                      {d.status}
                    </Badge>
                    <Badge tone="neutral">{d.source}</Badge>
                    {d.commitSha ? (
                      <span className="font-mono text-xs text-zinc-500">{d.commitSha.slice(0, 7)}</span>
                    ) : null}
                  </div>
                  {d.commitMessage ? (
                    <p className="mt-1 text-sm truncate">{d.commitMessage}</p>
                  ) : null}
                </div>
                <div className="text-right text-xs text-zinc-500 whitespace-nowrap">
                  {new Date(d.createdAt).toLocaleString()}
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
