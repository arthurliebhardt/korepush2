import { and, desc, eq } from "drizzle-orm";
import { Badge, Card, CardContent, StatusDot } from "@korepush/ui";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/access";
import { schema } from "@korepush/db";
import { DeployButton } from "./deploy-button";

export const dynamic = "force-dynamic";

export default async function ProjectOverview({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { project } = await requireProject(projectId);

  const [env, latest, primaryDomain] = await Promise.all([
    db.query.environments.findFirst({
      where: and(
        eq(schema.environments.projectId, project.id),
        eq(schema.environments.type, "production"),
      ),
    }),
    db.query.deployments.findFirst({
      where: eq(schema.deployments.projectId, project.id),
      orderBy: desc(schema.deployments.createdAt),
    }),
    db.query.domains.findFirst({
      where: and(eq(schema.domains.projectId, project.id), eq(schema.domains.isPrimary, true)),
    }),
  ]);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-2">
        <CardContent className="space-y-4">
          <Row label="Status">
            {latest ? (
              <Badge tone="neutral" className="inline-flex items-center gap-1.5">
                <StatusDot status={latest.status} />
                {latest.status}
              </Badge>
            ) : (
              <span className="text-sm text-zinc-500">No deployments yet</span>
            )}
          </Row>
          <Row label="Repository">
            <span className="text-sm font-mono">{project.gitRepoUrl}</span>
          </Row>
          <Row label="Branch">
            <span className="text-sm font-mono">{project.gitDefaultBranch}</span>
          </Row>
          <Row label="Dockerfile">
            <span className="text-sm font-mono">{project.dockerfilePath}</span>
          </Row>
          <Row label="Build context">
            <span className="text-sm font-mono">{project.buildContext}</span>
          </Row>
          <Row label="Port">
            <span className="text-sm font-mono">{project.port}</span>
          </Row>
          <Row label="Primary domain">
            {primaryDomain ? (
              <a
                href={`https://${primaryDomain.hostname}`}
                className="text-sm font-mono text-blue-600 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                {primaryDomain.hostname}
              </a>
            ) : (
              <span className="text-sm text-zinc-500">none</span>
            )}
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <h3 className="font-medium">Actions</h3>
          {env ? (
            <DeployButton
              projectId={project.id}
              environmentId={env.id}
              defaultBranch={project.gitDefaultBranch}
            />
          ) : null}
          <a
            href={`/dashboard/projects/${project.id}/deployments`}
            className="inline-flex h-9 w-full items-center justify-center rounded-md border border-zinc-300 dark:border-zinc-700 px-4 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            View deployments
          </a>
          <a
            href={`/dashboard/projects/${project.id}/logs`}
            className="inline-flex h-9 w-full items-center justify-center rounded-md border border-zinc-300 dark:border-zinc-700 px-4 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Runtime logs
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-2 last:border-b-0 last:pb-0">
      <span className="text-sm text-zinc-500">{label}</span>
      <div className="text-right min-w-0 truncate">{children}</div>
    </div>
  );
}
