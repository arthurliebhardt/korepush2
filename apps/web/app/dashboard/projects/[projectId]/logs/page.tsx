import { and, eq } from "drizzle-orm";
import { Card, CardContent } from "@korepush/ui";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/access";
import { schema } from "@korepush/db";
import { RuntimeLogsClient } from "./runtime-logs-client";

export const dynamic = "force-dynamic";

export default async function LogsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project } = await requireProject(projectId);
  const env = await db.query.environments.findFirst({
    where: and(
      eq(schema.environments.projectId, project.id),
      eq(schema.environments.type, "production"),
    ),
  });
  if (!env) return <p>No production environment.</p>;

  return (
    <Card>
      <CardContent>
        <RuntimeLogsClient projectId={project.id} environmentId={env.id} />
      </CardContent>
    </Card>
  );
}
