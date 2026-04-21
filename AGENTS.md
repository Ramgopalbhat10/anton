# Anton — Agent Instructions

Anton is a minimal coding-agent harness, built as a learning project to understand how production systems (Claude Code, Codex, Devin, Hermes, OpenClaw) work under the hood. Read these notes before making changes.

## Stack

- **TypeScript** (`strict: true`) — no `any`, no non-null `!` unless justified.
- **Next.js 16** (App Router, Turbopack) + **React 19**.
- **Tailwind CSS v4** (`@theme inline`, OKLCH tokens, dark theme by default).
- **shadcn/ui conventions** — Radix primitives + `cva` variants. Keep primitives unopinionated; compose in feature components.
- **Vercel AI SDK v6** (`ai`, `@ai-sdk/react`) via **OpenRouter** (`@openrouter/ai-sdk-provider`).
- **SQLite** (`better-sqlite3`, WAL journaling, FK enforced) + **Drizzle ORM** (schema in `src/db/schema.ts`, migrations in `src/db/migrations/`).
- **Zod v4** for tool input schemas and API validation.
- **Node runtime** — never Edge. The harness needs filesystem and shell access.

## Architecture

The central pattern is the **harness / model split** (lifted from Claude Code, Hermes, OpenClaw):

- **Model** decides what to do — `streamText` orchestrates a multi-step tool loop bounded by `stopWhen: stepCountIs(N)`.
- **Harness** executes what the model decided — tool registry, permission gate, workspace sandbox.

```
Browser (useChat) ── SSE ──▶ /api/chat
                               │
                               ▼
                    streamText({ model, tools, stopWhen })
                               │
                    think → tool_call → permission gate → execute → observe → loop
                               │
                    SQLite (sessions, messages, tool_calls)
```

Every tool argument that is a path MUST go through `resolveInWorkspace(...)` in `src/agent/sandbox.ts`. Paths escaping `WORKSPACE_ROOT` (via `..`, absolute paths, or symlinks) are rejected before `execute` runs. `bash` uses `execa` with `cwd: WORKSPACE_ROOT`, a timeout, and an output cap. **No `sudo`. The agent never writes to the project source itself.**

## Layout

```
app/
  api/chat/route.ts          # streamText endpoint (harness entry point)
  layout.tsx, page.tsx, globals.css
components/
  chat/                      # feature components (message-list, composer, model-picker, chat)
  ui/                        # shadcn primitives (button, textarea, ...)
src/
  agent/
    loop.ts                  # streamText wrapper + system prompt (Phase 2)
    sandbox.ts               # path resolution + validation (Phase 2)
    permissions.ts           # permission middleware (Phase 2)
    tools/                   # read-file, write-file, bash, grep, glob (Phase 2)
  db/
    schema.ts                # Drizzle tables
    client.ts                # better-sqlite3 + drizzle
    migrations/              # generated; do not hand-edit
    migrate.ts               # migration runner
  lib/
    providers.ts             # openrouter client + MODEL_CATALOG
lib/
  utils.ts                   # cn() (clsx + tailwind-merge)
workspace/                   # default WORKSPACE_ROOT — agent-writable, gitignored
```

Path aliases: `@/*` → project root, so `@/components/...`, `@/lib/utils`, `@/src/db/schema`.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server (Turbopack) at http://localhost:3000 |
| `pnpm build` / `pnpm start` | Production build + start |
| `pnpm lint` | ESLint (flat config) — must pass |
| `pnpm typecheck` | `tsc --noEmit` — must pass |
| `pnpm db:generate` | Generate Drizzle migration from `schema.ts` |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Drizzle Studio |

Run `pnpm typecheck` and `pnpm lint` before committing. If you change the schema, also run `pnpm db:generate` and commit the resulting migration.

## Environment

`.env.local` (gitignored) needs:

```
OPENROUTER_API_KEY=sk-or-v1-...
DEFAULT_MODEL=anthropic/claude-haiku-4.5
WORKSPACE_ROOT=./workspace
DATABASE_URL=./anton.db
```

Never log the API key. Never commit `.env.local`, `anton.db`, or anything under `workspace/`.

## Conventions

- Prefer editing existing files over creating new ones; do not scaffold files "for later".
- No default exports for components — named exports only.
- Server-only code never imports from `components/` or `app/` client code; client components never import from `src/db/` or `src/agent/`.
- Tool definitions are `tool({ description, inputSchema: z.object({...}), execute })`. Keep them pure; side-effects live in `execute`. Every risky tool carries `riskLevel: "risky"` so the permission gate can intercept it.
- UI renders messages from `message.parts` (v6 UIMessage shape), not `message.content`. Tool calls render as collapsible cards, never as raw JSON.
- Streaming custom data (permission requests, tool progress) uses AI SDK custom data parts through `toUIMessageStreamResponse`, not ad-hoc JSON frames.
- Comments explain **why**, not what. Default is no comment.

## Roadmap phase

Phases 1–3 (streaming chat MVP, agent loop + tools + permission gate, persistent sessions) are shipped. Phase 4 (markdown, diff viewer, token counter, QoL) is next — see `README.md` for the full roadmap. Do not implement later phases ahead of time.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
