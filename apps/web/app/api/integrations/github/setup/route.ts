import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { requireUserTeam } from "@/lib/access";
import { buildAppManifest } from "@/lib/github";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "kp_gh_state";

/**
 * GET /api/integrations/github/setup?org=<optional-org-login>
 *
 * Kicks off the GitHub App manifest flow.
 *
 * GitHub's manifest endpoint is POST-only with the manifest in the form body
 * (a query-string redirect just lands on the empty "Create App" page). So we
 * return a tiny HTML page that auto-submits a POST form to GitHub — the
 * operator's browser bounces straight to the manifest-pre-filled creation
 * page.
 *
 * State is signed into an httpOnly cookie and bounced back via the redirect
 * URL for CSRF protection on the callback.
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

  // GitHub App names must be globally unique. Append a short random suffix so
  // multiple Korepush instances (or retries after a failed Create) never
  // collide. Operators can still override the base name via the APP_NAME env.
  const suffix = randomBytes(3).toString("hex"); // 6 lowercase hex chars
  const manifest = buildAppManifest({
    name: `${env.appName} ${suffix}`,
    baseUrl: env.betterAuthUrl,
  });
  const state = randomBytes(24).toString("base64url");

  const action = org
    ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new?state=${encodeURIComponent(state)}`
    : `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`;

  const manifestJson = JSON.stringify(manifest)
    // Make the JSON safe inside a single-quoted HTML attribute.
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&#39;")
    .replace(/"/g, "&quot;");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Connecting to GitHub…</title>
  <meta name="color-scheme" content="light dark" />
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
           background: #fafafa; color: #18181b; display: grid; place-items: center;
           height: 100vh; margin: 0; }
    @media (prefers-color-scheme: dark) {
      body { background: #09090b; color: #fafafa; }
    }
    .card { text-align: center; }
    button { font: inherit; padding: 8px 16px; border-radius: 6px;
             background: #18181b; color: white; border: 0; cursor: pointer; }
    @media (prefers-color-scheme: dark) {
      button { background: #fafafa; color: #18181b; }
    }
  </style>
</head>
<body>
  <div class="card">
    <p>Redirecting you to GitHub to create the Korepush App…</p>
    <noscript>
      <p>JavaScript is disabled. Click below to continue:</p>
      <form method="POST" action="${action}">
        <input type="hidden" name="manifest" value='${manifestJson}' />
        <button type="submit">Continue to GitHub</button>
      </form>
    </noscript>
  </div>
  <form id="f" method="POST" action="${action}" style="display:none">
    <input type="hidden" name="manifest" value='${manifestJson}' />
  </form>
  <script>document.getElementById('f').submit();</script>
</body>
</html>`;

  const res = new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.betterAuthUrl.startsWith("https://"),
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
