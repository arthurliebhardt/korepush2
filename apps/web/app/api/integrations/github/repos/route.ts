import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUserTeam } from "@/lib/access";
import { schema } from "@korepush/db";
import { decrypt } from "@korepush/crypto";
import { getInstallationToken, listInstallationRepos } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/github/repos
 *
 * Live-fetch the repositories the operator's GitHub App installation can see.
 * We don't cache server-side: GitHub is fast, and any cache would have to be
 * invalidated when the operator grants/revokes repo access.
 */
export async function GET() {
  let ctx;
  try {
    ctx = await requireUserTeam();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 401 },
    );
  }

  const integration = await db.query.gitIntegrations.findFirst({
    where: and(
      eq(schema.gitIntegrations.teamId, ctx.team.id),
      eq(schema.gitIntegrations.provider, "github"),
    ),
  });
  if (!integration?.installationId || !integration.appId || !integration.privateKeyEncrypted) {
    return NextResponse.json({ error: "github-not-connected" }, { status: 409 });
  }

  try {
    const privateKey = decrypt(integration.privateKeyEncrypted, env.encryptionKey);
    const token = await getInstallationToken({
      appId: integration.appId,
      privateKeyPem: privateKey,
      installationId: integration.installationId,
    });
    const repos = await listInstallationRepos(token);
    return NextResponse.json({
      account: {
        login: integration.installationAccountLogin,
        type: integration.installationAccountType,
      },
      repos: repos
        .sort((a, b) => (b.pushed_at ?? "").localeCompare(a.pushed_at ?? ""))
        .map((r) => ({
          id: r.id,
          name: r.name,
          fullName: r.full_name,
          private: r.private,
          description: r.description,
          defaultBranch: r.default_branch,
          htmlUrl: r.html_url,
          cloneUrl: r.clone_url,
          pushedAt: r.pushed_at,
        })),
    });
  } catch (err) {
    console.error("[github] list repos failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
