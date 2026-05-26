"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@korepush/ui";

export function DeployButton({
  projectId,
  environmentId,
  defaultBranch,
}: {
  projectId: string;
  environmentId: string;
  defaultBranch: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <Button
      className="w-full"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        const res = await fetch(`/api/projects/${projectId}/deployments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ environmentId, gitRef: defaultBranch }),
        });
        setLoading(false);
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          router.push(`/dashboard/projects/${projectId}/deployments/${data.deploymentId}`);
        }
      }}
    >
      {loading ? "Deploying..." : "Deploy"}
    </Button>
  );
}
