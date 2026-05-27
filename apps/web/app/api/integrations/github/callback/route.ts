import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUserTeam } from "@/lib/access";
import { schema } from "@korepush/db";
import { encrypt } from "@korepush/crypto";
import { newId } from "@korepush/queue";
import { convertManifestCode } from "@/lib/github";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "kp_gh_state";

/**
 * GET /api/integrations/github/callback?code=<temp>&state=<csrf>
 *
 * GitHub bounces here after the operator creates the App from our manifest.
 * We:
 *   1. Verify the state cookie matches.
 *   2. Exchange the temp code for the App's real credentials.
 *   3. Encrypt and store them.
 *   4. Redirect the operator to GitHub's install page, where they pick repos.
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
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);

  if (!code) {
    return redirectWithError("github-no-code");
  }
  if (!state || !cookieState || state !== cookieState) {
    return redirectWithError("github-state-mismatch");
  }

  let app;
  try {
    app = await convertManifestCode(code);
  } catch (err) {
    console.error("[github] manifest conversion failed:", err);
    return redirectWithError("github-exchange-failed");
  }

  // Upsert: if an integration already exists for this team, replace it.
  // This lets the operator re-run the connect flow after a failed install.
  const existing = await db.query.gitIntegrations.findFirst({
    where: and(
      eq(schema.gitIntegrations.teamId, ctx.team.id),
      eq(schema.gitIntegrations.provider, "github"),
    ),
    columns: { id: true },
  });

  const id = existing?.id ?? newId("gint");
  const values = {
    id,
    teamId: ctx.team.id,
    provider: "github",
    appId: String(app.id),
    appSlug: app.slug,
    appName: app.name,
    htmlUrl: app.html_url,
    clientId: app.client_id,
    clientSecretEncrypted: encrypt(app.client_secret, env.encryptionKey),
    privateKeyEncrypted: encrypt(app.pem, env.encryptionKey),
    webhookSecretEncrypted: app.webhook_secret
      ? encrypt(app.webhook_secret, env.encryptionKey)
      : null,
    installationId: null,
    installationAccountLogin: null,
    installationAccountType: null,
    createdByUserId: ctx.session.user.id,
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(schema.gitIntegrations)
      .set(values)
      .where(eq(schema.gitIntegrations.id, existing.id));
  } else {
    await db.insert(schema.gitIntegrations).values(values);
  }

  // Clear the state cookie and bounce the operator to GitHub's install page.
  const installUrl = `${app.html_url}/installations/new?state=${encodeURIComponent(id)}`;
  const res = NextResponse.redirect(installUrl, { status: 302 });
  res.cookies.delete(STATE_COOKIE);
  return res;
}

function redirectWithError(code: string): NextResponse {
  return NextResponse.redirect(
    `${env.betterAuthUrl}/dashboard/settings/integrations?error=${code}`,
    { status: 302 },
  );
}
