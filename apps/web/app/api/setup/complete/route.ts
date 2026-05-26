import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { auth } from "@/lib/auth";
import { isSetupCompleted, markSetupCompleted } from "@/lib/setup";
import { schema } from "@korepush/db";
import { slugify } from "@korepush/shared";
import { newId } from "@korepush/queue";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(60).optional(),
});

/**
 * First-run setup. Open until the first user is created.
 *
 * Anyone who reaches the dashboard URL before an admin account exists can
 * claim it — same model as Coolify / Vercel self-hosted. The installer prints
 * the dashboard URL so the operator can be the first to hit /setup.
 *
 * After the first user is created, this endpoint refuses further requests.
 */
export async function POST(req: Request) {
  if (await isSetupCompleted()) {
    return NextResponse.json({ error: "setup already completed" }, { status: 409 });
  }

  // Race-safe second check: refuse if any user row exists, even if the
  // platform_settings flag hasn't been written yet.
  const existing = await db.execute(sql`SELECT 1 FROM "user" LIMIT 1`);
  const rows = existing as unknown as Array<unknown>;
  if (rows.length > 0) {
    await markSetupCompleted();
    return NextResponse.json({ error: "setup already completed" }, { status: 409 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const { email, password, name } = parsed.data;

  // Create the Owner account via Better Auth so password hashing matches the
  // rest of the auth flow.
  let userId: string;
  try {
    const signUp = await auth.api.signUpEmail({
      body: { email, password, name: name ?? email.split("@")[0]! },
    });
    userId = signUp.user.id;
  } catch {
    // Better Auth may refuse if disableSignUp is on; fall back to direct insert
    // using the same scrypt format Better Auth uses for credential accounts.
    userId = newId("usr");
    await db.insert(schema.user).values({
      id: userId,
      name: name ?? email.split("@")[0]!,
      email,
      emailVerified: true,
    });
    await db.insert(schema.account).values({
      id: newId("acc"),
      userId,
      accountId: email,
      providerId: "credential",
      password: await scryptHashCompat(password),
    });
  }

  const teamId = newId("team");
  const teamSlug = slugify(name ?? "default");

  await db.transaction(async (tx) => {
    await tx.insert(schema.teams).values({
      id: teamId,
      name: name ?? "Default",
      slug: teamSlug,
      createdByUserId: userId,
    });
    await tx.insert(schema.teamMembers).values({
      id: newId("tm"),
      teamId,
      userId,
      role: "owner",
    });
    // The default local K3s cluster the worker manages via its in-cluster
    // service account. kubeconfig stays null because we use service account auth.
    await tx.insert(schema.clusters).values({
      id: newId("cls"),
      teamId,
      name: "Local K3s",
      slug: "local",
      status: "healthy",
      kubeconfigEncrypted: null,
      defaultRegistryUrl: env.registryUrl,
      defaultIngressClass: "traefik",
    });
  });

  await markSetupCompleted();

  return NextResponse.json({ ok: true });
}

async function scryptHashCompat(password: string): Promise<string> {
  const { scryptSync, randomBytes } = await import("node:crypto");
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
