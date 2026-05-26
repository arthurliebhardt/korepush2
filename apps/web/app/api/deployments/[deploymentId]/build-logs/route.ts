import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireDeployment } from "@/lib/access";
import { schema } from "@korepush/db";

type Params = { params: Promise<{ deploymentId: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { deploymentId } = await params;
    const { deployment } = await requireDeployment(deploymentId);
    const lines = await db.query.buildLogs.findMany({
      where: eq(schema.buildLogs.deploymentId, deployment.id),
      orderBy: (l, { asc }) => asc(l.seq),
      limit: 10_000,
    });
    return NextResponse.json({
      deploymentId: deployment.id,
      status: deployment.status,
      lines: lines.map((l) => ({ seq: l.seq, stream: l.stream, line: l.line, at: l.createdAt })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    );
  }
}
