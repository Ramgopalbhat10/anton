FROM node:22-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ git && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends git bash sqlite3 python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install -g tsx

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=80

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Install migration dependencies (drizzle-orm, better-sqlite3) for the migration script
RUN npm install drizzle-orm better-sqlite3 --no-save

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
