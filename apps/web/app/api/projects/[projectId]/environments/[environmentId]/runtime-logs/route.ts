import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/access";
import { coreApi } from "@/lib/k8s";
import { schema } from "@korepush/db";
import { selectorLabels } from "@korepush/shared";

type Params = { params: Promise<{ projectId: string; environmentId: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { projectId, environmentId } = await params;
    const { project } = await requireProject(projectId);
    const environment = await db.query.environments.findFirst({
      where: and(
        eq(schema.environments.id, environmentId),
        eq(schema.environments.projectId, project.id),
      ),
    });
    if (!environment) {
      return NextResponse.json({ error: "environment not found" }, { status: 404 });
    }

    const url = new URL(req.url);
    const tailLines = Math.min(Number(url.searchParams.get("tail") ?? 200), 5_000);

    const core = coreApi();
    const labels = selectorLabels({
      projectSlug: project.slug,
      environmentSlug: environment.slug,
      component: "web",
    });
    const labelSelector = Object.entries(labels)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");

    const podList = await core.listNamespacedPod({
      namespace: environment.namespace,
      labelSelector,
    });

    const logs = await Promise.all(
      podList.items.map(async (pod) => {
        const podName = pod.metadata?.name;
        if (!podName) return null;
        const containerName = pod.spec?.containers?.[0]?.name;
        try {
          const res = await core.readNamespacedPodLog({
            namespace: environment.namespace,
            name: podName,
            container: containerName,
            tailLines,
            timestamps: true,
          });
          return {
            pod: podName,
            container: containerName,
            phase: pod.status?.phase,
            lines: typeof res === "string" ? res.split("\n").filter(Boolean) : [],
          };
        } catch (err) {
          return {
            pod: podName,
            container: containerName,
            phase: pod.status?.phase,
            lines: [],
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    return NextResponse.json({
      namespace: environment.namespace,
      logs: logs.filter(Boolean),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
