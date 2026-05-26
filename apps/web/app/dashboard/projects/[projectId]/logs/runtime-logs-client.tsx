"use client";

import { useEffect, useState } from "react";
import { Button, CodeBlock } from "@korepush/ui";

interface PodLogs {
  pod: string;
  container?: string;
  phase?: string;
  lines: string[];
  error?: string;
}

export function RuntimeLogsClient({
  projectId,
  environmentId,
}: {
  projectId: string;
  environmentId: string;
}) {
  const [logs, setLogs] = useState<PodLogs[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/environments/${environmentId}/runtime-logs?tail=200`,
      );
      const data = await res.json();
      if (res.ok) setLogs(data.logs ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    if (!autoRefresh) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Runtime logs</h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </Button>
        </div>
      </div>
      {logs.length === 0 ? (
        <p className="text-sm text-zinc-500">No pods running yet.</p>
      ) : (
        <div className="space-y-3">
          {logs.map((p) => (
            <div key={p.pod}>
              <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                <span className="font-mono">{p.pod}</span>
                <span>·</span>
                <span>{p.phase}</span>
              </div>
              {p.error ? (
                <p className="text-xs text-red-600">{p.error}</p>
              ) : (
                <CodeBlock>{p.lines.join("\n")}</CodeBlock>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
