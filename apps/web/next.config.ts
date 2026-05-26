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

  // Our workspace packages import siblings with explicit `.js` suffixes
  // (NodeNext-style, required by tsx in the worker). webpack doesn't try other
  // extensions when one is specified, so we teach it that `.js` imports may
  // actually be `.ts`/`.tsx` source files.
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default config;
