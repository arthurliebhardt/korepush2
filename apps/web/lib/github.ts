import { createSign } from "node:crypto";

const GH_API = "https://api.github.com";

// ============================================================================
// Manifest flow — generates a per-instance GitHub App on the operator's behalf
// ============================================================================

export interface ManifestBuildArgs {
  /** Pretty display name shown to the operator on GitHub. */
  name: string;
  /** Public-facing base URL of this Korepush instance, no trailing slash. */
  baseUrl: string;
}

/**
 * Build the JSON manifest that we hand to GitHub's app-creation flow.
 *
 * GitHub renders a "Create App" page pre-filled with these settings. After
 * the operator clicks Create, GitHub redirects to redirect_url with a
 * short-lived ?code= that we exchange for the App's real credentials.
 *
 * Docs: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
 */
export function buildAppManifest(args: ManifestBuildArgs) {
  const baseUrl = args.baseUrl.replace(/\/+$/, "");
  return {
    name: args.name,
    url: baseUrl,
    hook_attributes: {
      url: `${baseUrl}/api/webhooks/github`,
      active: true,
    },
    redirect_url: `${baseUrl}/api/integrations/github/callback`,
    callback_urls: [`${baseUrl}/api/integrations/github/callback`],
    setup_url: `${baseUrl}/api/integrations/github/installed`,
    setup_on_update: true,
    public: false,
    default_permissions: {
      contents: "read",
      metadata: "read",
      pull_requests: "read",
      checks: "write",
      statuses: "write",
    },
    default_events: ["push", "pull_request"],
  };
}

/**
 * URL to start the manifest flow. The state value is bounced back to us in the
 * callback for CSRF protection.
 *
 * Pass an `org` to install on a GitHub organization; omit for a personal account.
 */
export function buildManifestUrl(args: {
  manifest: object;
  state: string;
  org?: string;
}): string {
  const path = args.org
    ? `https://github.com/organizations/${encodeURIComponent(args.org)}/settings/apps/new`
    : `https://github.com/settings/apps/new`;
  const qs = new URLSearchParams({
    manifest: JSON.stringify(args.manifest),
    state: args.state,
  });
  return `${path}?${qs.toString()}`;
}

export interface AppCredentials {
  id: number;
  slug: string;
  name: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string | null;
  pem: string;
  html_url: string;
  owner: { login: string; type: string };
}

/**
 * Exchange the manifest's temporary code for the GitHub App's real
 * credentials. The code is single-use and expires in 10 min.
 */
export async function convertManifestCode(code: string): Promise<AppCredentials> {
  const res = await fetch(`${GH_API}/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: { accept: "application/vnd.github+json" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub manifest conversion failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as AppCredentials;
}

// ============================================================================
// App authentication — JWT signed with the App's RSA private key
// ============================================================================

/**
 * Build a short-lived JWT to authenticate as the GitHub App itself.
 * Used to mint installation tokens. Expires in 10 minutes (max GitHub allows).
 */
export function buildAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  // iat is in the past to tolerate clock drift between us and GitHub.
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
 * Mint a short-lived (1 hour) installation token. This is the token we use
 * to clone private repos, list installation repositories, etc.
 */
export async function getInstallationToken(args: {
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
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub installation token failed (${res.status}): ${text}`);
  }
  return (JSON.parse(text) as { token: string }).token;
}

/**
 * Fetch the installation's metadata: which account it's installed on,
 * the account type (User | Organization), html_url, etc.
 */
export async function getInstallation(args: {
  appId: string;
  privateKeyPem: string;
  installationId: string;
}) {
  const jwt = buildAppJwt(args.appId, args.privateKeyPem);
  const res = await fetch(
    `${GH_API}/app/installations/${encodeURIComponent(args.installationId)}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${jwt}`,
      },
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub get installation failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as {
    id: number;
    account: { login: string; type: string; html_url: string };
    html_url: string;
  };
}

// ============================================================================
// Repository listing
// ============================================================================

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  default_branch: string;
  html_url: string;
  clone_url: string;
  pushed_at: string | null;
}

/**
 * List all repositories visible to this installation. Paginates through.
 */
export async function listInstallationRepos(installationToken: string): Promise<GitHubRepo[]> {
  const all: GitHubRepo[] = [];
  let page = 1;
  // Hard cap to keep an accidental misuse from spinning forever.
  while (page <= 30) {
    const res = await fetch(
      `${GH_API}/installation/repositories?per_page=100&page=${page}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${installationToken}`,
        },
      },
    );
    if (!res.ok) {
      throw new Error(`GitHub list repos failed (${res.status}): ${await res.text()}`);
    }
    const body = (await res.json()) as {
      total_count: number;
      repositories: GitHubRepo[];
    };
    all.push(...body.repositories);
    if (body.repositories.length < 100) break;
    page++;
  }
  return all;
}
