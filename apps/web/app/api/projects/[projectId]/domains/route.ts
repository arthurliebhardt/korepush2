import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/access";
import { schema } from "@korepush/db";
import { isValidHostname } from "@korepush/shared";
import { enqueue, newId } from "@korepush/queue";

const Create = z.object({
  environmentId: z.string().min(1),
  hostname: z.string().min(3).max(253),
  makePrimary: z.boolean().optional(),
});

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { projectId } = await params;
    const { project } = await requireProject(projectId);
    const domains = await db.query.domains.findMany({
      where: eq(schema.domains.projectId, project.id),
      orderBy: (d, { desc }) => [desc(d.isPrimary), desc(d.createdAt)],
    });
    return NextResponse.json({ domains });
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
  if (!isValidHostname(input.hostname)) {
    return NextResponse.json({ error: `invalid hostname "${input.hostname}"` }, { status: 400 });
  }
  const env_ = await db.query.environments.findFirst({
    where: and(
      eq(schema.environments.id, input.environmentId),
      eq(schema.environments.projectId, ctx.project.id),
    ),
  });
  if (!env_) return NextResponse.json({ error: "environment not found" }, { status: 404 });

  const existingPrimary = await db.query.domains.findFirst({
    where: and(
      eq(schema.domains.environmentId, env_.id),
      eq(schema.domains.isPrimary, true),
    ),
  });

  const id = newId("dom");
  const isPrimary = input.makePrimary ?? !existingPrimary;
  await db.insert(schema.domains).values({
    id,
    projectId: ctx.project.id,
    environmentId: env_.id,
    hostname: input.hostname.toLowerCase(),
    isPrimary,
    verificationStatus: "pending",
    tlsStatus: "pending",
  });

  if (isPrimary && existingPrimary) {
    await db
      .update(schema.domains)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(eq(schema.domains.id, existingPrimary.id));
  }

  const { jobId } = await enqueue(db, "sync.domain", { domainId: id });
  return NextResponse.json({ ok: true, id, jobId });
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
