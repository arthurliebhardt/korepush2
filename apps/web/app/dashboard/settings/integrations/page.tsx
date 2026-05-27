import { and, eq } from "drizzle-orm";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@korepush/ui";
import { db } from "@/lib/db";
import { requireUserTeam } from "@/lib/access";
import { schema } from "@korepush/db";
import { IntegrationsClient } from "./integrations-client";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const ctx = await requireUserTeam();
  const integration = await db.query.gitIntegrations.findFirst({
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

  const { connected, error } = await searchParams;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Connect GitHub so you can pick repositories from a list when creating projects.
        </p>
      </div>

      {connected ? (
        <div className="rounded-md border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-950/30 px-4 py-3 text-sm">
          GitHub connected.
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm">
          Connection failed: <code className="font-mono">{error}</code>.
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <GitHubMark />
              GitHub
            </CardTitle>
            <StatusBadge integration={integration} />
          </div>
        </CardHeader>
        <CardContent>
          <IntegrationsClient
            integration={
              integration
                ? {
                    appName: integration.appName,
                    appSlug: integration.appSlug,
                    htmlUrl: integration.htmlUrl,
                    installationId: integration.installationId,
                    installationAccountLogin: integration.installationAccountLogin,
                    installationAccountType: integration.installationAccountType,
                  }
                : null
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({
  integration,
}: {
  integration: { installationId: string | null } | null | undefined;
}) {
  if (!integration) return <Badge tone="neutral">Not connected</Badge>;
  if (!integration.installationId) return <Badge tone="yellow">App created — needs install</Badge>;
  return <Badge tone="green">Connected</Badge>;
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.78 1.2 1.78 1.2 1.03 1.77 2.71 1.26 3.37.97.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11.04 11.04 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.4-5.26 5.69.41.36.77 1.05.77 2.12 0 1.53-.01 2.77-.01 3.14 0 .31.21.67.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}
