import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Resolve the monorepo root so Next.js standalone bundles workspace deps.
const __dirname = dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: join(__dirname, "../.."),
  reactStrictMode: true,
  transpilePackages: [
    "@korepush/db",
    "@korepush/queue",
    "@korepush/crypto",
    "@korepush/shared",
    "@korepush/ui",
  ],
  experimental: {
    serverActions: { bodySizeLimit: "1mb" },
  },
  serverExternalPackages: ["postgres", "@kubernetes/client-node"],
};

export default config;
