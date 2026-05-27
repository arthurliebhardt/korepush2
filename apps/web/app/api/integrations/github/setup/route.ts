import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { requireUserTeam } from "@/lib/access";
import { buildAppManifest, buildManifestUrl } from "@/lib/github";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "kp_gh_state";

/**
 * GET /api/integrations/github/setup?org=<optional-org-login>
 *
 * Kicks off the GitHub App manifest flow. We:
 *   1. Build a manifest with this instance's callback / setup URLs.
 *   2. Sign a random state into a short-lived cookie.
 *   3. 302 to GitHub's "Create App from manifest" page.
 *
 * GitHub bounces the operator's browser back to /api/integrations/github/callback
 * with ?code= and ?state= after they click "Create GitHub App".
 */
export async function GET(req: Request) {
  try {
    await requireUserTeam();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const org = url.searchParams.get("org") ?? undefined;

  const manifest = buildAppManifest({
    name: env.appName,
    baseUrl: env.betterAuthUrl,
  });
  const state = randomBytes(24).toString("base64url");
  const target = buildManifestUrl({ manifest, state, org });

  const res = NextResponse.redirect(target, { status: 302 });
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.betterAuthUrl.startsWith("https://"),
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
