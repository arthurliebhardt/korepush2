"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@korepush/ui";

interface Item {
  id: string;
  key: string;
  createdAt: string;
  updatedAt: string;
}

export function EnvVarsClient({
  projectId,
  environmentId,
  initial,
}: {
  projectId: string;
  environmentId: string;
  initial: Item[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  async function addVar() {
    setError(null);
    const res = await fetch(
      `/api/projects/${projectId}/environments/${environmentId}/env-vars`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: newKey, value: newValue }),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to add variable");
      return;
    }
    setNewKey("");
    setNewValue("");
    router.refresh();
  }

  async function updateVar(id: string) {
    const res = await fetch(`/api/env-vars/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: editValue }),
    });
    if (res.ok) {
      setEditing(null);
      setEditValue("");
      setItems((items) =>
        items.map((it) => (it.id === id ? { ...it, updatedAt: new Date().toISOString() } : it)),
      );
    }
  }

  async function deleteVar(id: string) {
    if (!confirm("Delete this variable? Apps will lose access on the next deploy.")) return;
    const res = await fetch(`/api/env-vars/${id}`, { method: "DELETE" });
    if (res.ok) {
      setItems((items) => items.filter((it) => it.id !== id));
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="font-medium">Add variable</h3>
        <div className="grid grid-cols-[1fr_2fr_auto] gap-2 items-end">
          <div>
            <Label htmlFor="newkey">Key</Label>
            <Input
              id="newkey"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="DATABASE_URL"
            />
          </div>
          <div>
            <Label htmlFor="newvalue">Value</Label>
            <Input
              id="newvalue"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              type="password"
              placeholder="•••••••"
            />
          </div>
          <Button onClick={addVar} disabled={!newKey || !newValue}>
            Add
          </Button>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <p className="text-xs text-zinc-500">
          Values are encrypted at rest. Changes apply on the next deployment.
        </p>
      </div>

      <div>
        <h3 className="font-medium mb-2">{items.length} variables</h3>
        {items.length === 0 ? (
          <p className="text-sm text-zinc-500">No variables defined.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {items.map((v) => (
              <li key={v.id} className="py-2 flex items-center gap-3">
                <span className="font-mono text-sm flex-1 truncate">{v.key}</span>
                {editing === v.id ? (
                  <>
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      type="password"
                      className="max-w-xs"
                    />
                    <Button size="sm" onClick={() => updateVar(v.id)}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-xs text-zinc-400">••••••••</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(v.id);
                        setEditValue("");
                      }}
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteVar(v.id)}>
                      Delete
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
