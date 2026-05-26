"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, Label } from "@korepush/ui";

interface Domain {
  id: string;
  hostname: string;
  isPrimary: boolean;
  verificationStatus: string;
  tlsStatus: string;
}

export function DomainsClient({
  projectId,
  environmentId,
  initial,
}: {
  projectId: string;
  environmentId: string;
  initial: Domain[];
}) {
  const router = useRouter();
  const [hostname, setHostname] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ environmentId, hostname }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to add domain");
      return;
    }
    setHostname("");
    router.refresh();
  }

  async function makePrimary(id: string) {
    await fetch(`/api/domains/${id}/make-primary`, { method: "POST" });
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Remove this domain?")) return;
    await fetch(`/api/domains/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="font-medium">Add a domain</h3>
        <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
          <div>
            <Label htmlFor="host">Hostname</Label>
            <Input
              id="host"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="api.example.com"
            />
          </div>
          <Button onClick={add} disabled={!hostname}>
            Add
          </Button>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <p className="text-xs text-zinc-500">
          Point an A or CNAME record at this server, then add the hostname here. TLS is issued
          automatically when the domain resolves.
        </p>
      </div>

      <div>
        <h3 className="font-medium mb-2">{initial.length} domain(s)</h3>
        {initial.length === 0 ? (
          <p className="text-sm text-zinc-500">No domains configured.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {initial.map((d) => (
              <li key={d.id} className="py-2 flex items-center gap-3">
                <span className="font-mono text-sm flex-1 truncate">{d.hostname}</span>
                {d.isPrimary ? <Badge tone="blue">primary</Badge> : null}
                <Badge tone={toneFor(d.verificationStatus)}>verify: {d.verificationStatus}</Badge>
                <Badge tone={toneFor(d.tlsStatus)}>tls: {d.tlsStatus}</Badge>
                {!d.isPrimary ? (
                  <Button size="sm" variant="ghost" onClick={() => makePrimary(d.id)}>
                    Make primary
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => remove(d.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function toneFor(status: string) {
  switch (status) {
    case "active":
    case "verified":
      return "green" as const;
    case "issuing":
    case "pending":
      return "yellow" as const;
    case "failed":
      return "red" as const;
    default:
      return "neutral" as const;
  }
}
