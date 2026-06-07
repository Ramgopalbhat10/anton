#!/bin/bash
set -e

export DATABASE_URL="${DATABASE_URL:-/storage/anton.db}"
export WORKSPACE_ROOT="${WORKSPACE_ROOT:-/storage/workspace}"
export ANTON_LOCAL_WORKSPACES_ROOT="${ANTON_LOCAL_WORKSPACES_ROOT:-/storage/workspaces}"

mkdir -p "$(dirname "$DATABASE_URL")"
mkdir -p "$WORKSPACE_ROOT"
mkdir -p "$ANTON_LOCAL_WORKSPACES_ROOT"

echo "[entrypoint] running migrations against $DATABASE_URL"
tsx src/db/migrate.ts

echo "[entrypoint] starting server on $HOSTNAME:$PORT"
exec node server.js
