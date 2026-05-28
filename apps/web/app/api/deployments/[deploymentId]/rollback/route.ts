import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDeployment } from "@/lib/access";
import { schema } from "@korepush/db";
import { enqueue, newId } from "@korepush/queue";

type Params = { params: Promise<{ deploymentId: string }> };

export async function POST(_: Request, { params }: Params) {
  try {
    const { deploymentId } = await params;
    const { deployment, project, session } = await requireDeployment(deploymentId);

    if (deployment.status !== "ready") {
      return NextResponse.json(
        { error: "only successful deployments can be rolled back to" },
        { status: 400 },
      );
    }
    if (!deployment.imageDigest && !deployment.imageTag) {
      return NextResponse.json({ error: "target deployment has no image to redeploy" }, { status: 400 });
    }

    const newDeploymentId = newId("dep");
    await db.insert(schema.deployments).values({
      id: newDeploymentId,
      projectId: project.id,
      environmentId: deployment.environmentId,
      status: "queued",
      source: "rollback",
      gitRef: deployment.gitRef,
      commitSha: deployment.commitSha,
      commitMessage: deployment.commitMessage,
      imageRepository: deployment.imageRepository,
      imageTag: deployment.imageTag,
      imageDigest: deployment.imageDigest,
      buildMode: deployment.buildMode,
      dockerfilePath: deployment.dockerfilePath,
      buildContext: deployment.buildContext,
      buildTarget: deployment.buildTarget,
      createdByUserId: session.user.id,
      rollbackFromDeploymentId: deployment.id,
    });

    const { jobId } = await enqueue(db, "rollback.deployment", {
      targetDeploymentId: deployment.id,
      newDeploymentId,
      createdByUserId: session.user.id,
    });

    return NextResponse.json({ deploymentId: newDeploymentId, jobId, status: "queued" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    );
  }
}
