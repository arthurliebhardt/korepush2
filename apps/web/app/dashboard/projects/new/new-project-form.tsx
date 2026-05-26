"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@korepush/ui";

export function NewProjectForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const body = {
      name: String(form.get("name") ?? ""),
      repoUrl: String(form.get("repoUrl") ?? ""),
      defaultBranch: String(form.get("defaultBranch") ?? "main"),
      dockerfilePath: String(form.get("dockerfilePath") ?? "Dockerfile"),
      buildContext: String(form.get("buildContext") ?? "."),
      port: Number(form.get("port") ?? 3000),
    };
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setLoading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to create project");
      return;
    }
    router.push(`/dashboard/projects/${data.projectId}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field name="name" label="Project name" placeholder="API" required />
      <Field
        name="repoUrl"
        label="Repository URL"
        placeholder="https://github.com/acme/api"
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <Field name="defaultBranch" label="Default branch" defaultValue="main" />
        <Field name="port" label="Container port" type="number" defaultValue="3000" />
      </div>
      <Field
        name="dockerfilePath"
        label="Dockerfile path"
        defaultValue="Dockerfile"
        hint="Relative to repository root. e.g. apps/api/Dockerfile"
      />
      <Field
        name="buildContext"
        label="Build context"
        defaultValue="."
        hint="Directory passed to docker build."
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create project"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  hint,
  ...rest
}: { name: string; label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...rest} />
      {hint ? <p className="text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}
