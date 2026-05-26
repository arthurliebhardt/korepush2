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
    // First admin is created via /setup/complete with a setup token.
    // We disable open sign-up; new users are added via team invites later.
    disableSignUp: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
});

export type Auth = typeof auth;
