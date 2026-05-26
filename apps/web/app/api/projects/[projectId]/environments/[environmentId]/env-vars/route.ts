import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireProject } from "@/lib/access";
import { schema } from "@korepush/db";
import { encrypt } from "@korepush/crypto";
import { isValidEnvVarKey } from "@korepush/shared";
import { newId } from "@korepush/queue";

const Create = z.object({
  key: z.string().min(1).max(128),
  value: z.string().max(64 * 1024),
});

type Params = { params: Promise<{ projectId: string; environmentId: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { projectId, environmentId } = await params;
    await requireProject(projectId);
    const rows = await db.query.envVars.findMany({
      where: eq(schema.envVars.environmentId, environmentId),
      columns: { id: true, key: true, createdAt: true, updatedAt: true },
      orderBy: (e, { asc }) => asc(e.key),
    });
    return NextResponse.json({ envVars: rows });
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

  const { environmentId } = await params;
  const parsed = Create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const { key, value } = parsed.data;
  if (!isValidEnvVarKey(key)) {
    return NextResponse.json({ error: `invalid env var key "${key}"` }, { status: 400 });
  }

  // Confirm env belongs to the project.
  const env_ = await db.query.environments.findFirst({
    where: and(eq(schema.environments.id, environmentId), eq(schema.environments.projectId, ctx.project.id)),
  });
  if (!env_) return NextResponse.json({ error: "environment not found" }, { status: 404 });

  const id = newId("ev");
  await db
    .insert(schema.envVars)
    .values({
      id,
      projectId: ctx.project.id,
      environmentId,
      key,
      valueEncrypted: encrypt(value, env.encryptionKey),
    })
    .onConflictDoUpdate({
      target: [schema.envVars.environmentId, schema.envVars.key],
      set: {
        valueEncrypted: encrypt(value, env.encryptionKey),
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ ok: true, id, key });
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
