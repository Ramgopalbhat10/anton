#!/bin/bash
set -e

export DATABASE_URL="${DATABASE_URL:-/storage/anton.db}"
export WORKSPACE_ROOT="${WORKSPACE_ROOT:-/storage/workspace}"
export ANTON_LOCAL_WORKSPACES_ROOT="${ANTON_LOCAL_WORKSPACES_ROOT:-/storage/workspaces}"
export GH_CONFIG_DIR="${GH_CONFIG_DIR:-/storage/gh}"
export GH_PROMPT_DISABLED="${GH_PROMPT_DISABLED:-1}"
export GH_NO_UPDATE_NOTIFIER="${GH_NO_UPDATE_NOTIFIER:-1}"
export GH_NO_EXTENSION_UPDATE_NOTIFIER="${GH_NO_EXTENSION_UPDATE_NOTIFIER:-1}"

mkdir -p "$(dirname "$DATABASE_URL")"
mkdir -p "$WORKSPACE_ROOT"
mkdir -p "$ANTON_LOCAL_WORKSPACES_ROOT"
mkdir -p "$GH_CONFIG_DIR"

if [ -n "${GIT_AUTHOR_NAME:-}" ]; then
  git config --global user.name "$GIT_AUTHOR_NAME"
fi
if [ -n "${GIT_AUTHOR_EMAIL:-}" ]; then
  git config --global user.email "$GIT_AUTHOR_EMAIL"
fi

if command -v gh >/dev/null 2>&1; then
  GH_AUTH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-${GITHUB_PAT:-}}}"
  if [ -n "$GH_AUTH_TOKEN" ]; then
    if ! gh auth status --hostname github.com >/dev/null 2>&1; then
      if [ -s "$GH_CONFIG_DIR/hosts.yml" ]; then
        echo "[entrypoint] repairing stale gh auth state"
        rm -f "$GH_CONFIG_DIR/hosts.yml"
      fi
      if ! printf '%s' "$GH_AUTH_TOKEN" | gh auth login --hostname github.com --with-token >/dev/null; then
        echo "[entrypoint] warning: gh auth login failed"
      fi
    fi
    if gh auth status --hostname github.com >/dev/null 2>&1; then
      gh config set git_protocol https --host github.com >/dev/null || echo "[entrypoint] warning: gh git_protocol setup failed"
      gh auth setup-git --hostname github.com >/dev/null || echo "[entrypoint] warning: gh git credential setup failed"
    else
      echo "[entrypoint] warning: gh is not authenticated"
    fi
  else
    echo "[entrypoint] gh is installed; set GH_TOKEN, GITHUB_TOKEN, or GITHUB_PAT to enable GitHub CLI auth"
  fi
  unset GH_AUTH_TOKEN
fi

echo "[entrypoint] running migrations against $DATABASE_URL"
tsx src/db/migrate.ts

echo "[entrypoint] starting server on $HOSTNAME:$PORT"
exec node server.js
