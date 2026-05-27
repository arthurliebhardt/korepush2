import { createSign } from "node:crypto";

const GH_API = "https://api.github.com";

/**
 * Build a short-lived JWT to authenticate as the GitHub App itself. Used to
 * mint per-installation access tokens. Mirrors apps/web/lib/github.ts —
 * duplicated rather than extracted to a shared package to keep that one
 * dependency-free / browser-safe.
 */
function buildAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer.sign(privateKeyPem).toString("base64url");
  return `${signingInput}.${signature}`;
}

/**
 * Mint a short-lived (1 hour) GitHub installation token. The build Job
 * uses this inside the clone URL: https://x-access-token:<token>@github.com/...
 */
export async function getGithubInstallationToken(args: {
  appId: string;
  privateKeyPem: string;
  installationId: string;
}): Promise<string> {
  const jwt = buildAppJwt(args.appId, args.privateKeyPem);
  const res = await fetch(
    `${GH_API}/app/installations/${encodeURIComponent(args.installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${jwt}`,
      },
    },
  );
  if (!res.ok) {
    throw new Error(
      `GitHub installation token request failed (${res.status}): ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { token: string; expires_at: string };
  return body.token;
}
