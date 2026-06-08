FROM node:22-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ git && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends git bash sqlite3 && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
RUN pnpm add -g tsx

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=80

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy migration dependencies from builder (already compiled for ARM64)
COPY --from=builder /app/node_modules/.pnpm/drizzle-orm@* ./node_modules/.pnpm/drizzle-orm@*
COPY --from=builder /app/node_modules/.pnpm/better-sqlite3@* ./node_modules/.pnpm/better-sqlite3@*
COPY --from=builder /app/node_modules/.pnpm/drizzle-orm@*/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder /app/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 ./node_modules/better-sqlite3

COPY --from=builder /app/src/db/migrations ./src/db/migrations
COPY --from=builder /app/src/db/schema.ts ./src/db/schema.ts
COPY --from=builder /app/src/db/migrate.ts ./src/db/migrate.ts
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY docker/hooks/pre-backup /hooks/pre-backup
RUN chmod +x /hooks/pre-backup

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
