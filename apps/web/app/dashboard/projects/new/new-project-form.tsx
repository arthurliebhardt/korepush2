"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@korepush/ui";

interface Repo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  htmlUrl: string;
  cloneUrl: string;
  pushedAt: string | null;
}

type Mode = "github" | "url";

export function NewProjectForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Source-of-repo selector
  const [mode, setMode] = useState<Mode>("github");
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [account, setAccount] = useState<{ login: string | null } | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);

  // Manual fields
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [dockerfilePath, setDockerfilePath] = useState("Dockerfile");
  const [buildContext, setBuildContext] = useState(".");
  const [buildMode, setBuildMode] = useState<"dockerfile" | "railpack">("dockerfile");
  const [port, setPort] = useState(3000);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/integrations/github/repos");
      if (cancelled) return;
      if (res.status === 409) {
        // Not connected — fall back to URL mode.
        setRepos([]);
        setMode("url");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReposError(data.error ?? "Failed to load repositories");
        setMode("url");
        return;
      }
      setRepos(data.repos ?? []);
      setAccount(data.account ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredRepos = useMemo(() => {
    if (!repos) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q),
    );
  }, [repos, filter]);

  const selectedRepo = useMemo(
    () => repos?.find((r) => r.id === selectedRepoId) ?? null,
    [repos, selectedRepoId],
  );

  // When a repo is picked, auto-fill name/branch/cloneUrl.
  useEffect(() => {
    if (!selectedRepo) return;
    setRepoUrl(selectedRepo.cloneUrl);
    setDefaultBranch(selectedRepo.defaultBranch);
    if (!name) setName(selectedRepo.name);
  }, [selectedRepo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const finalRepoUrl = mode === "github" ? selectedRepo?.cloneUrl ?? "" : repoUrl;
    const finalBranch = mode === "github" ? selectedRepo?.defaultBranch ?? "main" : defaultBranch;

    if (!finalRepoUrl) {
      setError("Pick a repository or paste a URL");
      setLoading(false);
      return;
    }
    if (!name) {
      setError("Project name is required");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        repoUrl: finalRepoUrl,
        defaultBranch: finalBranch,
        dockerfilePath,
        buildContext,
        buildMode,
        port: Number(port),
      }),
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
    <form onSubmit={onSubmit} className="space-y-5">
      <ModeTabs
        mode={mode}
        onChange={setMode}
        githubAvailable={repos !== null && repos.length > 0}
        githubError={reposError}
      />

      {mode === "github" ? (
        <GitHubRepoPicker
          repos={filteredRepos}
          allRepos={repos}
          account={account}
          filter={filter}
          setFilter={setFilter}
          selectedRepoId={selectedRepoId}
          setSelectedRepoId={setSelectedRepoId}
        />
      ) : (
        <Field
          name="repoUrl"
          label="Repository URL"
          placeholder="https://github.com/acme/api"
          value={repoUrl}
          onChange={(v) => setRepoUrl(v)}
          required
        />
      )}

      <div className="border-t border-zinc-100 dark:border-zinc-800 pt-5 space-y-4">
        <Field
          name="name"
          label="Project name"
          placeholder="api"
          value={name}
          onChange={setName}
          required
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            name="defaultBranch"
            label="Branch"
            value={defaultBranch}
            onChange={setDefaultBranch}
            disabled={mode === "github" && !!selectedRepo}
          />
          <Field
            name="port"
            label="Container port"
            type="number"
            value={String(port)}
            onChange={(v) => setPort(Number(v))}
          />
        </div>

        <div className="space-y-1">
          <Label>Build</Label>
          <div className="flex gap-1" role="group" aria-label="Build mode">
            <BuildModeButton active={buildMode === "dockerfile"} onClick={() => setBuildMode("dockerfile")}>
              Dockerfile
            </BuildModeButton>
            <BuildModeButton active={buildMode === "railpack"} onClick={() => setBuildMode("railpack")}>
              Railpack (auto-detect)
            </BuildModeButton>
          </div>
          <p className="text-xs text-zinc-500">
            {buildMode === "railpack"
              ? "Railpack detects your stack and builds the image — no Dockerfile needed."
              : "Build from a Dockerfile in your repo."}
          </p>
        </div>

        {buildMode === "dockerfile" ? (
          <Field
            name="dockerfilePath"
            label="Dockerfile path"
            value={dockerfilePath}
            onChange={setDockerfilePath}
            hint="Relative to repo root, e.g. apps/api/Dockerfile"
          />
        ) : null}
        <Field
          name="buildContext"
          label="Build context"
          value={buildContext}
          onChange={setBuildContext}
          hint="Directory passed to the build."
        />
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create project"}
        </Button>
      </div>
    </form>
  );
}

function ModeTabs({
  mode,
  onChange,
  githubAvailable,
  githubError,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  githubAvailable: boolean;
  githubError: string | null;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800">
      <TabButton
        active={mode === "github"}
        onClick={() => onChange("github")}
        disabled={!githubAvailable && !githubError}
      >
        From GitHub
      </TabButton>
      <TabButton active={mode === "url"} onClick={() => onChange("url")}>
        Paste URL
      </TabButton>
      {!githubAvailable && !githubError ? (
        <span className="ml-auto text-xs text-zinc-500">
          <Link href="/dashboard/settings/integrations" className="hover:underline">
            Connect GitHub →
          </Link>
        </span>
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "px-3 py-2 text-sm border-b-2 -mb-px " +
        (active
          ? "border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100"
          : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed")
      }
    >
      {children}
    </button>
  );
}

function GitHubRepoPicker({
  repos,
  allRepos,
  account,
  filter,
  setFilter,
  selectedRepoId,
  setSelectedRepoId,
}: {
  repos: Repo[];
  allRepos: Repo[] | null;
  account: { login: string | null } | null;
  filter: string;
  setFilter: (v: string) => void;
  selectedRepoId: number | null;
  setSelectedRepoId: (id: number | null) => void;
}) {
  if (allRepos === null) {
    return <p className="text-sm text-zinc-500">Loading repositories…</p>;
  }
  if (allRepos.length === 0) {
    return (
      <div className="text-sm text-zinc-500 space-y-2">
        <p>
          No repositories accessible. Grant access to specific repos in your{" "}
          <Link href="/dashboard/settings/integrations" className="hover:underline">
            GitHub integration settings
          </Link>
          .
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>
          {account?.login ? <>From {account.login} — </> : null}
          {allRepos.length} repositor{allRepos.length === 1 ? "y" : "ies"}
        </span>
        <Link
          href="/dashboard/settings/integrations"
          className="hover:underline"
        >
          Manage access →
        </Link>
      </div>
      <Input
        placeholder="Filter…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="max-h-72 overflow-y-auto border border-zinc-200 dark:border-zinc-800 rounded-md divide-y divide-zinc-100 dark:divide-zinc-800">
        {repos.length === 0 ? (
          <p className="p-3 text-sm text-zinc-500">No matches.</p>
        ) : (
          repos.map((r) => (
            <label
              key={r.id}
              className={
                "flex items-start gap-3 p-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 " +
                (selectedRepoId === r.id ? "bg-zinc-50 dark:bg-zinc-900" : "")
              }
            >
              <input
                type="radio"
                name="repo"
                className="mt-1"
                checked={selectedRepoId === r.id}
                onChange={() => setSelectedRepoId(r.id)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm truncate">{r.fullName}</span>
                  {r.private ? (
                    <span className="text-xs text-zinc-500 border border-zinc-300 dark:border-zinc-700 rounded px-1.5">
                      private
                    </span>
                  ) : null}
                </div>
                {r.description ? (
                  <p className="text-xs text-zinc-500 truncate mt-0.5">
                    {r.description}
                  </p>
                ) : null}
              </div>
              <span className="text-xs text-zinc-400 whitespace-nowrap">
                {r.defaultBranch}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function Field({
  name,
  label,
  hint,
  value,
  onChange,
  ...rest
}: {
  name: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "value" | "onChange">) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
      {hint ? <p className="text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

function BuildModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        "px-3 py-1.5 text-sm rounded-md border " +
        (active
          ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900")
      }
    >
      {children}
    </button>
  );
}
