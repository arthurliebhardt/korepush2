function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  encryptionKey: required("ENCRYPTION_KEY"),
  registryUrl:
    process.env.REGISTRY_URL ?? "registry.korepush-system.svc.cluster.local:5000",
  platformNamespace: process.env.PLATFORM_NAMESPACE ?? "korepush-system",
  workerId:
    process.env.HOSTNAME ?? `worker-${Math.random().toString(36).slice(2, 8)}`,
  // BuildKit image used by the per-deploy build Job. Default is the rootless
  // build of moby/buildkit, which works on default K3s without --privileged.
  buildImage:
    process.env.BUILD_IMAGE ?? "moby/buildkit:v0.18.2-rootless",
  defaultIngressClass: process.env.INGRESS_CLASS ?? "traefik",
  certIssuer: process.env.CERT_ISSUER ?? null,
};
