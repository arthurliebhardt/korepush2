"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@korepush/ui";

interface Initial {
  name: string;
  defaultBranch: string;
  dockerfilePath: string;
  buildContext: string;
  port: number;
}

export function ProjectSettingsForm({
  projectId,
  initial,
}: {
  projectId: string;
  initial: Initial;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: state.name,
        defaultBranch: state.defaultBranch,
        dockerfilePath: state.dockerfilePath,
        buildContext: state.buildContext,
        port: Number(state.port),
      }),
    });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Failed to save");
    else router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <Pair label="Name">
        <Input value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} />
      </Pair>
      <Pair label="Default branch">
        <Input
          value={state.defaultBranch}
          onChange={(e) => setState({ ...state, defaultBranch: e.target.value })}
        />
      </Pair>
      <Pair label="Dockerfile path">
        <Input
          value={state.dockerfilePath}
          onChange={(e) => setState({ ...state, dockerfilePath: e.target.value })}
        />
      </Pair>
      <Pair label="Build context">
        <Input
          value={state.buildContext}
          onChange={(e) => setState({ ...state, buildContext: e.target.value })}
        />
      </Pair>
      <Pair label="Port">
        <Input
          type="number"
          value={state.port}
          onChange={(e) => setState({ ...state, port: Number(e.target.value) })}
        />
      </Pair>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-center gap-3">
      <Label>{label}</Label>
      <div>{children}</div>
    </div>
  );
}
