import { eq } from "drizzle-orm";
import { Badge, Card, CardContent, StatusDot } from "@korepush/ui";
import { db } from "@/lib/db";
import { requireUserTeam } from "@/lib/access";
import { schema } from "@korepush/db";

export const dynamic = "force-dynamic";

export default async function ClustersPage() {
  const ctx = await requireUserTeam();
  const clusters = await db.query.clusters.findMany({
    where: eq(schema.clusters.teamId, ctx.team.id),
  });

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Clusters</h1>
      {clusters.length === 0 ? (
        <p className="text-sm text-zinc-500">No clusters registered.</p>
      ) : (
        clusters.map((c) => (
          <Card key={c.id}>
            <CardContent className="space-y-1.5">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">{c.name}</h3>
                <Badge tone="neutral" className="inline-flex items-center gap-1.5">
                  <StatusDot status={c.status} />
                  {c.status}
                </Badge>
              </div>
              <p className="text-xs text-zinc-500">
                Registry: <span className="font-mono">{c.defaultRegistryUrl ?? "—"}</span>
              </p>
              <p className="text-xs text-zinc-500">
                Ingress class: <span className="font-mono">{c.defaultIngressClass}</span>
              </p>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
