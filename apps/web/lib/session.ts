import { headers } from "next/headers";
import { auth } from "./auth.js";

export type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

export async function getSession(): Promise<Session | null> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  return session ?? null;
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("Unauthorized");
  return s;
}
