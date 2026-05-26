import { and, eq } from "drizzle-orm";
import { Card, CardContent } from "@korepush/ui";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/access";
import { schema } from "@korepush/db";
import { DomainsClient } from "./domains-client";

export const dynamic = "force-dynamic";

export default async function DomainsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { project } = await requireProject(projectId);
  const env = await db.query.environments.findFirst({
    where: and(
      eq(schema.environments.projectId, project.id),
      eq(schema.environments.type, "production"),
    ),
  });
  if (!env) return <p>No production environment.</p>;

  const domains = await db.query.domains.findMany({
    where: eq(schema.domains.projectId, project.id),
    orderBy: (d, { desc }) => [desc(d.isPrimary), desc(d.createdAt)],
  });

  return (
    <Card>
      <CardContent>
        <DomainsClient
          projectId={project.id}
          environmentId={env.id}
          initial={domains.map((d) => ({
            id: d.id,
            hostname: d.hostname,
            isPrimary: d.isPrimary,
            verificationStatus: d.verificationStatus,
            tlsStatus: d.tlsStatus,
          }))}
        />
      </CardContent>
    </Card>
  );
}
