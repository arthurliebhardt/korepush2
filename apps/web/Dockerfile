# syntax=docker/dockerfile:1.7

# ---- builder ---------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /repo

RUN apk add --no-cache libc6-compat
RUN corepack enable

# Copy the whole monorepo. .dockerignore strips node_modules / .next / .git.
COPY . .

# Install all workspace deps (workspace symlinks happen here).
RUN pnpm install --frozen-lockfile=false

# Build the dashboard. Next.js produces a self-contained standalone tree
# under apps/web/.next/standalone because next.config.ts sets
# outputFileTracingRoot to the monorepo root.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @korepush/web build

# ---- runner ----------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Next.js standalone output: a single server.js + minimal node_modules.
# With outputFileTracingRoot at the monorepo root, the standalone tree is
# rooted there, so server.js lives at apps/web/server.js.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
