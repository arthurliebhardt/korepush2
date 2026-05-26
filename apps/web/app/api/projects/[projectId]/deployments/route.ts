import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/access";
import { schema } from "@korepush/db";
import { enqueue, newId } from "@korepush/queue";

const Create = z.object({
  environmentId: z.string().min(1),
  gitRef: z.string().min(1).default("main"),
  commitSha: z.string().optional(),
});

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { projectId } = await params;
    const { project } = await requireProject(projectId);

    const rows = await db.query.deployments.findMany({
      where: eq(schema.deployments.projectId, project.id),
      orderBy: desc(schema.deployments.createdAt),
      limit: 50,
      columns: {
        id: true,
        status: true,
        source: true,
        commitSha: true,
        commitMessage: true,
        imageDigest: true,
        createdAt: true,
        deployedAt: true,
        failedAt: true,
      },
    });

    return NextResponse.json({ deployments: rows });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 404 });
  }
}

export async function POST(req: Request, { params }: Params) {
  let ctx;
  try {
    const { projectId } = await params;
    ctx = await requireProject(projectId);
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 404 });
  }

  const parsed = Create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  const environment = await db.query.environments.findFirst({
    where: and(
      eq(schema.environments.id, input.environmentId),
      eq(schema.environments.projectId, ctx.project.id),
    ),
  });
  if (!environment) {
    return NextResponse.json({ error: "environment not found" }, { status: 404 });
  }

  const deploymentId = newId("dep");
  await db.insert(schema.deployments).values({
    id: deploymentId,
    projectId: ctx.project.id,
    environmentId: environment.id,
    status: "queued",
    source: "manual",
    gitRef: input.gitRef,
    commitSha: input.commitSha ?? null,
    dockerfilePath: ctx.project.dockerfilePath,
    buildContext: ctx.project.buildContext,
    buildTarget: ctx.project.buildTarget,
    createdByUserId: ctx.session.user.id,
  });

  const { jobId } = await enqueue(db, "deploy.project", {
    projectId: ctx.project.id,
    environmentId: environment.id,
    deploymentId,
    createdByUserId: ctx.session.user.id,
    gitRef: input.gitRef,
    commitSha: input.commitSha ?? null,
  });

  return NextResponse.json({ deploymentId, jobId, status: "queued" });
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
