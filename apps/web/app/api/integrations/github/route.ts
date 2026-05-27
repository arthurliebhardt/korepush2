import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireUserTeam } from "@/lib/access";
import { schema } from "@korepush/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/github
 *
 * Returns the current GitHub integration status for the caller's team:
 *   - none       — never connected
 *   - app_created — App credentials exist but installation hasn't happened
 *   - installed   — fully set up, repos can be listed
 */
export async function GET() {
  try {
    const ctx = await requireUserTeam();
    const row = await db.query.gitIntegrations.findFirst({
      where: and(
        eq(schema.gitIntegrations.teamId, ctx.team.id),
        eq(schema.gitIntegrations.provider, "github"),
      ),
      columns: {
        id: true,
        appSlug: true,
        appName: true,
        htmlUrl: true,
        installationId: true,
        installationAccountLogin: true,
        installationAccountType: true,
        createdAt: true,
      },
    });

    if (!row) return NextResponse.json({ status: "none" });
    if (!row.installationId) {
      return NextResponse.json({
        status: "app_created",
        integration: row,
        installUrl: row.htmlUrl ? `${row.htmlUrl}/installations/new` : null,
      });
    }
    return NextResponse.json({ status: "installed", integration: row });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 401 },
    );
  }
}

/**
 * DELETE /api/integrations/github
 *
 * Disconnect the GitHub App. We only delete our local record — operators
 * still need to revoke/uninstall the App on GitHub themselves (otherwise
 * re-connecting will create a duplicate App on their account).
 */
export async function DELETE() {
  try {
    const ctx = await requireUserTeam();
    await db
      .delete(schema.gitIntegrations)
      .where(
        and(
          eq(schema.gitIntegrations.teamId, ctx.team.id),
          eq(schema.gitIntegrations.provider, "github"),
        ),
      );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 401 },
    );
  }
}
