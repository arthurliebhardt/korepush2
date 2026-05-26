import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireProject } from "@/lib/access";
import { schema } from "@korepush/db";
import { encrypt } from "@korepush/crypto";

const Update = z.object({
  value: z.string().max(64 * 1024),
});

type Params = { params: Promise<{ envVarId: string }> };

async function resolve(envVarId: string) {
  const ev = await db.query.envVars.findFirst({ where: eq(schema.envVars.id, envVarId) });
  if (!ev) throw new Error("env var not found");
  const ctx = await requireProject(ev.projectId);
  return { ctx, ev };
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { envVarId } = await params;
    const { ev } = await resolve(envVarId);
    const parsed = Update.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    await db
      .update(schema.envVars)
      .set({
        valueEncrypted: encrypt(parsed.data.value, env.encryptionKey),
        updatedAt: new Date(),
      })
      .where(eq(schema.envVars.id, ev.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 404 });
  }
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    const { envVarId } = await params;
    const { ev } = await resolve(envVarId);
    await db.delete(schema.envVars).where(eq(schema.envVars.id, ev.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 404 });
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
