import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Badge, Card, CardContent, EmptyState, StatusDot } from "@korepush/ui";
import { db } from "@/lib/db";
import { requireUserTeam } from "@/lib/access";
import { schema } from "@korepush/db";

export const dynamic = "force-dynamic";

export default async function DashboardHome() {
  const ctx = await requireUserTeam();
  const projects = await db.query.projects.findMany({
    where: and(eq(schema.projects.teamId, ctx.team.id), isNull(schema.projects.deletedAt)),
    orderBy: desc(schema.projects.createdAt),
  });

  const enriched = await Promise.all(
    projects.map(async (p) => {
      const [latest, primaryDomain] = await Promise.all([
        db.query.deployments.findFirst({
          where: eq(schema.deployments.projectId, p.id),
          orderBy: desc(schema.deployments.createdAt),
        }),
        db.query.domains.findFirst({
          where: and(eq(schema.domains.projectId, p.id), eq(schema.domains.isPrimary, true)),
        }),
      ]);
      return { project: p, latest, primaryDomain };
    }),
  );

  if (enriched.length === 0) {
    return (
      <EmptyState
        title="No projects yet"
        description="Create a project from a Git repository to deploy your first app."
        action={
          <Link
            href="/dashboard/projects/new"
            className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-900 text-white px-4 text-sm font-medium hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Create your first project
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {enriched.length} project{enriched.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href="/dashboard/projects/new"
          className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-900 text-white px-4 text-sm font-medium hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          New project
        </Link>
      </div>

      <div className="grid gap-3">
        {enriched.map(({ project, latest, primaryDomain }) => (
          <Card key={project.id}>
            <CardContent>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/dashboard/projects/${project.id}`}
                      className="font-medium truncate hover:underline"
                    >
                      {project.name}
                    </Link>
                    {latest ? (
                      <Badge
                        tone={statusTone(latest.status)}
                        className="inline-flex items-center gap-1.5"
                      >
                        <StatusDot status={latest.status} />
                        {latest.status}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">no deployments</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500 truncate">
                    {project.gitRepoUrl} · branch {project.gitDefaultBranch}
                  </p>
                  {primaryDomain ? (
                    <p className="mt-1 text-xs text-zinc-500">
                      <a
                        href={`https://${primaryDomain.hostname}`}
                        className="hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        https://{primaryDomain.hostname}
                      </a>
                    </p>
                  ) : null}
                </div>
                <div className="text-right text-xs text-zinc-500 whitespace-nowrap">
                  {latest?.deployedAt
                    ? new Date(latest.deployedAt).toLocaleString()
                    : latest?.createdAt
                      ? new Date(latest.createdAt).toLocaleString()
                      : "—"}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function statusTone(status: string) {
  switch (status) {
    case "ready":
      return "green" as const;
    case "failed":
      return "red" as const;
    case "building":
    case "deploying":
      return "blue" as const;
    case "rolled_back":
      return "yellow" as const;
    default:
      return "neutral" as const;
  }
}
