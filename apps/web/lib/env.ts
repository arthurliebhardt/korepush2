function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// TRUSTED_ORIGINS is a comma-separated list of origins Better Auth will
// accept for sign-in/up requests. Default "*" — fine for a single-tenant
// self-hosted dashboard. Operators behind a strict CORS policy can override.
function parseTrustedOrigins(raw: string | undefined): string[] {
  const value = (raw ?? "*").trim();
  if (value === "*") return ["*"];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  betterAuthSecret: required("BETTER_AUTH_SECRET"),
  betterAuthUrl: required("BETTER_AUTH_URL"),
  encryptionKey: required("ENCRYPTION_KEY"),
  trustedOrigins: parseTrustedOrigins(process.env.TRUSTED_ORIGINS),
  registryUrl: process.env.REGISTRY_URL ?? "registry.korepush-system.svc.cluster.local:5000",
  platformBaseDomain: process.env.PLATFORM_BASE_DOMAIN ?? null,
  platformNamespace: process.env.PLATFORM_NAMESPACE ?? "korepush-system",
};
