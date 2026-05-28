import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/access";
import { schema } from "@korepush/db";
import { enqueue } from "@korepush/queue";
import { validateBuildContext, validateDockerfilePath } from "@korepush/shared";

const Update = z.object({
  name: z.string().min(1).max(60).optional(),
  defaultBranch: z.string().min(1).optional(),
  dockerfilePath: z.string().min(1).optional(),
  buildContext: z.string().min(1).optional(),
  buildTarget: z.string().nullable().optional(),
  buildMode: z.enum(["dockerfile", "nixpacks"]).optional(),
  port: z.number().int().min(1).max(65535).optional(),
});

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { projectId } = await params;
    const { project } = await requireProject(projectId);
    return NextResponse.json({ project });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 404 });
  }
}

export async function PATCH(req: Request, { params }: Params) {
  let ctx;
  try {
    const { projectId } = await params;
    ctx = await requireProject(projectId);
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 404 });
  }

  const parsed = Update.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const u = parsed.data;
  try {
    const effMode = u.buildMode ?? ctx.project.buildMode;
    if (effMode === "dockerfile" && u.dockerfilePath) validateDockerfilePath(u.dockerfilePath);
    if (u.buildContext) validateBuildContext(u.buildContext);
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 400 });
  }

  await db
    .update(schema.projects)
    .set({
      ...(u.name !== undefined ? { name: u.name } : {}),
      ...(u.defaultBranch !== undefined ? { gitDefaultBranch: u.defaultBranch } : {}),
      ...(u.dockerfilePath !== undefined ? { dockerfilePath: u.dockerfilePath } : {}),
      ...(u.buildContext !== undefined ? { buildContext: u.buildContext } : {}),
      ...(u.buildTarget !== undefined ? { buildTarget: u.buildTarget } : {}),
      ...(u.buildMode !== undefined ? { buildMode: u.buildMode } : {}),
      ...(u.port !== undefined ? { port: u.port } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, ctx.project.id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    const { projectId } = await params;
    const { project } = await requireProject(projectId);

    await db
      .update(schema.projects)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projects.id, project.id));

    const { jobId } = await enqueue(db, "delete.project", { projectId: project.id });
    return NextResponse.json({ ok: true, jobId });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 404 });
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
