# syntax=docker/dockerfile:1.7

# ---- builder ---------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /repo
RUN corepack enable

# Copy the whole monorepo. .dockerignore strips node_modules / .git / build output.
COPY . .

# Install all workspace deps.
RUN pnpm install --frozen-lockfile=false

# `pnpm deploy` produces a self-contained directory at /out: the worker's
# package + a real node_modules tree with workspace deps copied in (not
# symlinks), and devDependencies stripped. This sidesteps the classic
# pnpm-in-Docker symlink problem.
RUN pnpm --filter @korepush/worker deploy --prod /out

# ---- runner ----------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /out ./

USER node

# We run the TypeScript entry directly via tsx (kept as a prod dep). This is
# simpler than maintaining a parallel tsc build and avoids the workspace
# dual-package hazard with .ts vs .js exports.
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
