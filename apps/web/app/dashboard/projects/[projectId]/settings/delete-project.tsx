"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@korepush/ui";

export function DeleteProject({ projectId, name }: { projectId: string; name: string }) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);

  async function onDelete() {
    setLoading(true);
    const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    setLoading(false);
    if (res.ok) router.push("/dashboard");
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">
        Type <code className="font-mono">{name}</code> to confirm.
      </p>
      <div className="flex gap-2">
        <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        <Button
          variant="destructive"
          disabled={confirmText !== name || loading}
          onClick={onDelete}
        >
          {loading ? "Deleting..." : "Delete project"}
        </Button>
      </div>
    </div>
  );
}
