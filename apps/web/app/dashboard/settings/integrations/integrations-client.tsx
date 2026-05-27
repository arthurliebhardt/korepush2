"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@korepush/ui";

interface Integration {
  appName: string | null;
  appSlug: string | null;
  htmlUrl: string | null;
  installationId: string | null;
  installationAccountLogin: string | null;
  installationAccountType: string | null;
}

export function IntegrationsClient({ integration }: { integration: Integration | null }) {
  const router = useRouter();
  const [org, setOrg] = useState("");
  const [confirm, setConfirm] = useState(false);

  if (!integration) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Korepush will create a private GitHub App on your account using GitHub&apos;s
          manifest flow. The App stays under your control — Korepush never sees your
          GitHub password, and you can revoke access at any time from GitHub&apos;s
          settings.
        </p>

        <div className="space-y-2">
          <Label htmlFor="org">Install on (optional)</Label>
          <Input
            id="org"
            placeholder="github-org-name (leave empty for your personal account)"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
          />
          <p className="text-xs text-zinc-500">
            Org name as it appears in github.com/<strong>your-org</strong>. Leave blank to
            install on your personal account.
          </p>
        </div>

        <a
          href={`/api/integrations/github/setup${org ? `?org=${encodeURIComponent(org)}` : ""}`}
          className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-900 text-white px-4 text-sm font-medium hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Connect GitHub
        </a>
      </div>
    );
  }

  // App was created but not installed yet.
  if (!integration.installationId) {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          App <strong>{integration.appName}</strong> created on GitHub but not installed
          yet. Pick which repositories Korepush can see.
        </p>
        {integration.htmlUrl ? (
          <a
            href={`${integration.htmlUrl}/installations/new`}
            className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-900 text-white px-4 text-sm font-medium hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Install on GitHub →
          </a>
        ) : null}
        <DisconnectButton />
      </div>
    );
  }

  // Fully connected.
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[180px_1fr] gap-y-2 text-sm">
        <dt className="text-zinc-500">App</dt>
        <dd>
          {integration.htmlUrl ? (
            <a
              href={integration.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono hover:underline"
            >
              {integration.appName}
            </a>
          ) : (
            <span className="font-mono">{integration.appName}</span>
          )}
        </dd>
        <dt className="text-zinc-500">Installed on</dt>
        <dd className="font-mono">
          {integration.installationAccountLogin}
          {integration.installationAccountType
            ? ` (${integration.installationAccountType})`
            : ""}
        </dd>
        <dt className="text-zinc-500">Installation ID</dt>
        <dd className="font-mono text-xs text-zinc-500">{integration.installationId}</dd>
      </dl>

      <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-2">
        {integration.htmlUrl ? (
          <a
            href={`${integration.htmlUrl}/installations/new`}
            className="text-sm hover:underline"
          >
            Change repository access →
          </a>
        ) : null}
        <div className="flex-1" />
        <DisconnectButton />
      </div>

      {confirm ? (
        <div className="rounded border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 p-3 text-sm space-y-2">
          <p>
            This removes Korepush&apos;s record of the integration. You&apos;ll also need
            to uninstall the App from GitHub manually (otherwise reconnecting creates a
            duplicate App).
          </p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                await fetch("/api/integrations/github", { method: "DELETE" });
                router.refresh();
              }}
            >
              Yes, disconnect
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );

  function DisconnectButton() {
    return (
      <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>
        Disconnect
      </Button>
    );
  }
}
