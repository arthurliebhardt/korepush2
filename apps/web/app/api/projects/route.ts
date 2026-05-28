import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireUserTeam } from "@/lib/access";
import { schema } from "@korepush/db";
import {
  isValidHostname,
  isValidSlug,
  namespaceName,
  slugify,
  validateBuildContext,
  validateDockerfilePath,
} from "@korepush/shared";
import { newId } from "@korepush/queue";

const Create = z.object({
  name: z.string().min(1).max(60),
  slug: z.string().optional(),
  repoUrl: z.string().url(),
  defaultBranch: z.string().min(1).default("main"),
  dockerfilePath: z.string().min(1).default("Dockerfile"),
  buildContext: z.string().min(1).default("."),
  buildTarget: z.string().optional(),
  buildMode: z.enum(["dockerfile", "railpack"]).default("dockerfile"),
  port: z.number().int().min(1).max(65535).default(3000),
  clusterId: z.string().optional(),
});

export async function GET() {
  try {
    const ctx = await requireUserTeam();
    const rows = await db
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        slug: schema.projects.slug,
        gitRepoUrl: schema.projects.gitRepoUrl,
        gitDefaultBranch: schema.projects.gitDefaultBranch,
      })
      .from(schema.projects)
      .where(and(eq(schema.projects.teamId, ctx.team.id), sql`deleted_at IS NULL`))
      .orderBy(desc(schema.projects.createdAt));

    // For each project, attach latest deployment status + primary domain.
    const projects = await Promise.all(
      rows.map(async (p) => {
        const [latest, primaryDomain] = await Promise.all([
          db.query.deployments.findFirst({
            where: eq(schema.deployments.projectId, p.id),
            orderBy: desc(schema.deployments.createdAt),
            columns: { id: true, status: true, commitSha: true, createdAt: true, deployedAt: true },
          }),
          db.query.domains.findFirst({
            where: and(eq(schema.domains.projectId, p.id), eq(schema.domains.isPrimary, true)),
            columns: { hostname: true },
          }),
        ]);
        return {
          ...p,
          latestDeployment: latest ?? null,
          primaryDomain: primaryDomain?.hostname ?? null,
        };
      }),
    );

    return NextResponse.json({ projects });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 401 });
  }
}

export async function POST(req: Request) {
  let ctx;
  try {
    ctx = await requireUserTeam();
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 401 });
  }

  const parsed = Create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  try {
    if (input.buildMode === "dockerfile") validateDockerfilePath(input.dockerfilePath);
    validateBuildContext(input.buildContext);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }

  const slug = input.slug ? slugify(input.slug) : slugify(input.name);
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: `invalid slug "${slug}"` }, { status: 400 });
  }

  // Resolve cluster — default to the first cluster for this team.
  let clusterId = input.clusterId;
  if (!clusterId) {
    const first = await db.query.clusters.findFirst({
      where: eq(schema.clusters.teamId, ctx.team.id),
      columns: { id: true },
    });
    if (!first) {
      return NextResponse.json({ error: "no cluster registered for team" }, { status: 400 });
    }
    clusterId = first.id;
  }

  const projectId = newId("proj");
  const environmentId = newId("env");

  await db.transaction(async (tx) => {
    await tx.insert(schema.projects).values({
      id: projectId,
      teamId: ctx.team.id,
      clusterId: clusterId!,
      name: input.name,
      slug,
      gitProvider: detectProvider(input.repoUrl),
      gitRepoUrl: input.repoUrl,
      gitDefaultBranch: input.defaultBranch,
      buildMode: input.buildMode,
      dockerfilePath: input.dockerfilePath,
      buildContext: input.buildContext,
      buildTarget: input.buildTarget ?? null,
      port: input.port,
    });

    await tx.insert(schema.environments).values({
      id: environmentId,
      projectId,
      type: "production",
      name: "Production",
      slug: "production",
      namespace: namespaceName({ projectSlug: slug, environmentSlug: "production" }),
      branch: input.defaultBranch,
      isActive: true,
    });
  });

  return NextResponse.json({ projectId, environmentId });
}

function detectProvider(url: string): string {
  if (/github\.com/i.test(url)) return "github";
  if (/gitlab\./i.test(url)) return "gitlab";
  if (/bitbucket\.org/i.test(url)) return "bitbucket";
  return "generic";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
// silence unused-import (kept for symmetry with other route files)
void isValidHostname;
