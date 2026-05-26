"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@korepush/ui";

export function RollbackButton({ deploymentId }: { deploymentId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={loading}
      onClick={async () => {
        if (!confirm("Roll back to this deployment? A new deployment will be created with this image.")) return;
        setLoading(true);
        const res = await fetch(`/api/deployments/${deploymentId}/rollback`, { method: "POST" });
        setLoading(false);
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.deploymentId) {
          router.refresh();
        }
      }}
    >
      {loading ? "Queuing..." : "Rollback to this"}
    </Button>
  );
}
