import { and, eq } from "drizzle-orm";
import { Card, CardContent } from "@korepush/ui";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/access";
import { schema } from "@korepush/db";
import { EnvVarsClient } from "./env-vars-client";

export const dynamic = "force-dynamic";

export default async function EnvVarsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project } = await requireProject(projectId);
  const env = await db.query.environments.findFirst({
    where: and(
      eq(schema.environments.projectId, project.id),
      eq(schema.environments.type, "production"),
    ),
  });
  if (!env) return <p>No production environment.</p>;

  const vars_ = await db.query.envVars.findMany({
    where: eq(schema.envVars.environmentId, env.id),
    columns: { id: true, key: true, createdAt: true, updatedAt: true },
    orderBy: (e, { asc }) => asc(e.key),
  });

  return (
    <Card>
      <CardContent>
        <EnvVarsClient
          projectId={project.id}
          environmentId={env.id}
          initial={vars_.map((v) => ({
            id: v.id,
            key: v.key,
            createdAt: v.createdAt.toISOString(),
            updatedAt: v.updatedAt.toISOString(),
          }))}
        />
      </CardContent>
    </Card>
  );
}
