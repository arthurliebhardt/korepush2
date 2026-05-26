import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/access";
import { schema } from "@korepush/db";
import { enqueue } from "@korepush/queue";

type Params = { params: Promise<{ domainId: string }> };

export async function POST(_: Request, { params }: Params) {
  try {
    const { domainId } = await params;
    const domain = await db.query.domains.findFirst({ where: eq(schema.domains.id, domainId) });
    if (!domain) throw new Error("domain not found");
    await requireProject(domain.projectId);

    await db.transaction(async (tx) => {
      await tx
        .update(schema.domains)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(
          and(
            eq(schema.domains.environmentId, domain.environmentId),
            ne(schema.domains.id, domain.id),
          ),
        );
      await tx
        .update(schema.domains)
        .set({ isPrimary: true, updatedAt: new Date() })
        .where(eq(schema.domains.id, domain.id));
    });

    await enqueue(db, "sync.domain", { domainId: domain.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 404 });
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
