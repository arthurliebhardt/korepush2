import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireUserTeam } from "@/lib/access";
import { schema } from "@korepush/db";

export async function GET() {
  try {
    const ctx = await requireUserTeam();
    const cluster = await db.query.clusters.findFirst({
      where: and(eq(schema.clusters.teamId, ctx.team.id), eq(schema.clusters.slug, "local")),
    });
    if (!cluster) return NextResponse.json({ error: "no local cluster" }, { status: 404 });
    return NextResponse.json({
      id: cluster.id,
      name: cluster.name,
      status: cluster.status,
      defaultRegistryUrl: cluster.defaultRegistryUrl,
      defaultIngressClass: cluster.defaultIngressClass,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 401 },
    );
  }
}
