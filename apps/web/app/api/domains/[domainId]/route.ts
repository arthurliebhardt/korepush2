import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/access";
import { schema } from "@korepush/db";
import { enqueue } from "@korepush/queue";

type Params = { params: Promise<{ domainId: string }> };

export async function DELETE(_: Request, { params }: Params) {
  try {
    const { domainId } = await params;
    const domain = await db.query.domains.findFirst({ where: eq(schema.domains.id, domainId) });
    if (!domain) throw new Error("domain not found");
    await requireProject(domain.projectId);

    await db.delete(schema.domains).where(eq(schema.domains.id, domain.id));
    // Re-enqueue a sync so the Ingress is updated to drop the host.
    await enqueue(db, "sync.domain", { domainId: domain.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 404 });
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
