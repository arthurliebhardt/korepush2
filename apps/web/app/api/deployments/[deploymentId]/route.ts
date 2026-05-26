import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireDeployment } from "@/lib/access";
import { schema } from "@korepush/db";

type Params = { params: Promise<{ deploymentId: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { deploymentId } = await params;
    const { deployment } = await requireDeployment(deploymentId);

    const events = await db.query.deploymentEvents.findMany({
      where: eq(schema.deploymentEvents.deploymentId, deployment.id),
      orderBy: desc(schema.deploymentEvents.createdAt),
      limit: 200,
    });

    return NextResponse.json({ ...deployment, events });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    );
  }
}
