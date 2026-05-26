import { and, eq } from "drizzle-orm";
import { db } from "./db.js";
import { schema } from "@korepush/db";
import { requireSession, type Session } from "./session.js";

/**
 * Resolve the team for the current user.
 *
 * MVP: there is only one team. The first user becomes Owner of that team
 * during /api/setup/complete; subsequent users (when invites land) are added
 * via team_members. This helper returns the first team a user belongs to.
 */
export async function requireUserTeam(session?: Session) {
  const s = session ?? (await requireSession());
  const membership = await db.query.teamMembers.findFirst({
    where: eq(schema.teamMembers.userId, s.user.id),
    with: { team: true },
  });
  if (!membership) {
    throw new Error("No team for current user");
  }
  return { session: s, team: membership.team, role: membership.role };
}

/**
 * Load a project by id and confirm the caller has access to its team.
 * Throws "Not found" rather than leaking project existence to outsiders.
 */
export async function requireProject(projectId: string, session?: Session) {
  const ctx = await requireUserTeam(session);
  const project = await db.query.projects.findFirst({
    where: and(eq(schema.projects.id, projectId), eq(schema.projects.teamId, ctx.team.id)),
  });
  if (!project) throw new Error("Project not found");
  return { ...ctx, project };
}

export async function requireEnvironment(envId: string, session?: Session) {
  const env = await db.query.environments.findFirst({
    where: eq(schema.environments.id, envId),
  });
  if (!env) throw new Error("Environment not found");
  const ctx = await requireProject(env.projectId, session);
  return { ...ctx, environment: env };
}

export async function requireDeployment(deploymentId: string, session?: Session) {
  const dep = await db.query.deployments.findFirst({
    where: eq(schema.deployments.id, deploymentId),
  });
  if (!dep) throw new Error("Deployment not found");
  const ctx = await requireProject(dep.projectId, session);
  return { ...ctx, deployment: dep };
}
