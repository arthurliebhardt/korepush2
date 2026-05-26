function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  betterAuthSecret: required("BETTER_AUTH_SECRET"),
  betterAuthUrl: required("BETTER_AUTH_URL"),
  encryptionKey: required("ENCRYPTION_KEY"),
  registryUrl: process.env.REGISTRY_URL ?? "registry.korepush-system.svc.cluster.local:5000",
  platformBaseDomain: process.env.PLATFORM_BASE_DOMAIN ?? null,
  platformNamespace: process.env.PLATFORM_NAMESPACE ?? "korepush-system",
};
