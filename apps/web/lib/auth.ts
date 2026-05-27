import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db.js";
import { env } from "./env.js";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: false,
  }),
  secret: env.betterAuthSecret,
  baseURL: env.betterAuthUrl,

  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    // We DO NOT use disableSignUp here. /api/setup/complete creates the first
    // user via auth.api.signUpEmail, which would fail if signups were disabled,
    // forcing a manual-hash fallback whose format Better Auth can't verify on
    // sign-in. Instead, the auth Route Handler wraps Better Auth and blocks
    // POST /api/auth/sign-up/* once setup_completed=true.
  },

  // A self-hosted dashboard's reachable URL can differ from BETTER_AUTH_URL
  // (e.g. the operator hits it via <vm>.orb.local during local testing, but
  // the secret was generated with the VPS's WAN IP). Allow any origin — for a
  // single-tenant control plane this is fine; CSRF is still covered by the
  // auth secret. Operators who want stricter CORS can set BETTER_AUTH_URL
  // and override TRUSTED_ORIGINS.
  trustedOrigins: env.trustedOrigins,

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
});

export type Auth = typeof auth;
