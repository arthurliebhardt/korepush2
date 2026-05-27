import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUserTeam } from "@/lib/access";
import { schema } from "@korepush/db";
import { decrypt } from "@korepush/crypto";
import { getInstallation } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/github/installed?installation_id=<id>&setup_action=<install|update>&state=<integration-id>
 *
 * GitHub redirects here after the operator installs (or updates) the App on
 * their account. The installation_id is the durable handle we use to mint
 * installation tokens; we store it on the integration row.
 *
 * We also fetch the installation's metadata (account login + type) so the
 * UI can show "Connected as <login>".
 */
export async function GET(req: Request) {
  let ctx;
  try {
    ctx = await requireUserTeam();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const installationId = url.searchParams.get("installation_id");
  if (!installationId) {
    return redirectWithError("github-no-installation");
  }

  const integration = await db.query.gitIntegrations.findFirst({
    where: and(
      eq(schema.gitIntegrations.teamId, ctx.team.id),
      eq(schema.gitIntegrations.provider, "github"),
    ),
  });
  if (!integration || !integration.appId || !integration.privateKeyEncrypted) {
    return redirectWithError("github-no-integration");
  }

  // Fetch metadata about the installation (account name, type).
  let meta;
  try {
    const privateKey = decrypt(integration.privateKeyEncrypted, env.encryptionKey);
    meta = await getInstallation({
      appId: integration.appId,
      privateKeyPem: privateKey,
      installationId,
    });
  } catch (err) {
    console.error("[github] get installation metadata failed:", err);
    // Non-fatal: store the installation_id anyway so the operator can retry.
    meta = null;
  }

  await db
    .update(schema.gitIntegrations)
    .set({
      installationId,
      installationAccountLogin: meta?.account.login ?? null,
      installationAccountType: meta?.account.type ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.gitIntegrations.id, integration.id));

  return NextResponse.redirect(
    `${env.betterAuthUrl}/dashboard/settings/integrations?connected=1`,
    { status: 302 },
  );
}

function redirectWithError(code: string): NextResponse {
  return NextResponse.redirect(
    `${env.betterAuthUrl}/dashboard/settings/integrations?error=${code}`,
    { status: 302 },
  );
}
