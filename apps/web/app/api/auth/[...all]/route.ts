import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { isSetupCompleted } from "@/lib/setup";

const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

/**
 * Wrap Better Auth's POST handler to enforce the "first visitor becomes Owner"
 * model: once setup_completed=true, any further attempts to create accounts
 * via /api/auth/sign-up/* are refused. /api/setup/complete is the only
 * privileged path that can create the very first user.
 */
export async function POST(req: Request) {
  const path = new URL(req.url).pathname;
  if (path.includes("/sign-up")) {
    if (await isSetupCompleted()) {
      return NextResponse.json(
        { error: "Sign-up is disabled. Contact your administrator." },
        { status: 403 },
      );
    }
  }
  return handlers.POST(req);
}
