# monkye-api — Railway (specs/10-deployment.md §3)
#
# Build context is the REPO ROOT, not apps/api: this is a pnpm workspace and the
# API imports @monkyesuite/{core,database,shared} as raw TypeScript source.
#   docker build -f apps/api/Dockerfile .
#
# There is no compile step, on purpose. apps/api has no `build` script — it runs
# TypeScript directly under tsx, and the workspace packages export ./src/*.ts.
# So the runtime image ships source + node_modules (devDependencies included,
# because tsx IS the runtime) rather than a bundle. What multi-stage buys us
# here is the filtered install: apps/web never enters the image, and apps/worker
# is a separate Go module that is not in the pnpm workspace at all.

# ---------------------------------------------------------------------------
# deps — resolve and install only the API's slice of the workspace
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# Manifests first so this layer caches until a dependency actually changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/core/package.json ./packages/core/
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/

# `...` selects @monkyesuite/api plus its workspace dependencies. NODE_ENV is
# deliberately unset here: devDependencies (tsx, typescript) are required at
# runtime and a production install would drop them.
RUN pnpm install --frozen-lockfile --filter @monkyesuite/api...

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# node_modules trees are copied as a set so pnpm's relative symlinks into
# node_modules/.pnpm stay intact. htmx.org must remain resolvable: the admin
# panel resolves and reads htmx.org/dist/htmx.min.js from node_modules on the
# first /admin request (apps/api/src/admin/index.ts) and serves it same-origin.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api ./apps/api
COPY packages/core ./packages/core
COPY packages/shared ./packages/shared

# packages/database ships more than source: migrate.ts reads functions.sql and
# the drizzle/ folder (migrations + meta/_journal.json + roles.sql) from disk at
# runtime. Dropping them would make the migrate step a silent no-op.
COPY packages/database ./packages/database

USER node
EXPOSE 8787

# The ONLY place migrations run. src/migrate.ts applies, in this order:
#   functions.sql  →  drizzle migrations  →  drizzle/roles.sql
# and `&&` means a failed migrate never starts the API. The worker never
# migrates; it assumes the schema exists.
CMD ["sh", "-c", "pnpm --filter @monkyesuite/database db:migrate && pnpm --filter @monkyesuite/api start"]
