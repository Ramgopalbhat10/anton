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
    mcp.ts                   # workspace MCP config loading + tool wrapping (Phase 5)
    sandbox.ts               # path resolution + validation (Phase 2)
    permissions.ts           # permission middleware (Phase 2)
    skills.ts                # workspace skill discovery (Phase 5)
    tools/                   # read-file, write-file, bash, grep, glob, memory, skills, delegate
  db/
    schema.ts                # Drizzle tables
    client.ts                # better-sqlite3 + drizzle
    migrations/              # generated; do not hand-edit
    migrate.ts               # migration runner
  lib/
    models.ts                # client-safe model catalog
    providers.ts             # server-side openrouter client
lib/
  utils.ts                   # cn() (clsx + tailwind-merge)
workspace/                   # default WORKSPACE_ROOT - agent-writable, gitignored
  skills/<slug>/SKILL.md     # optional project-local skills (Phase 5)
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

Run `pnpm typecheck` and `pnpm lint` before committing. Do not write test cases, add test files, or introduce test scripts for this project. If you change the schema, also run `pnpm db:generate` and commit the resulting migration.

## GitHub workflow

- Treat `ROADMAP.md` as the source of truth for ongoing implementation tasks. Before starting implementation, read the relevant roadmap section and keep the work scoped to one checklist item or a small coherent group of related checklist items.
- Before starting a new implementation, create or identify a GitHub issue that describes the requested change, scope, acceptance criteria, and verification plan. Reference that issue in the branch name, commit message, or PR body when practical.
- If the GitHub app connector cannot create the required issue, use the GitHub CLI instead: `gh issue create --repo <owner>/<repo> --title "<title>" --body-file -`.
- When a GitHub issue or PR completes a roadmap item, update `ROADMAP.md` in the same change by marking the item as `[✔️]`. Do not mark roadmap items complete before the related implementation is actually resolved.
- If implementation reveals missing work, add or refine checklist items in `ROADMAP.md` rather than burying follow-up tasks in chat history.
- For new implementation work, create a new feature branch before editing code. Use a descriptive prefix such as `codex/<short-topic>` for Codex-driven work.
- If the work clearly belongs to an existing feature branch, update that branch from `main` first, then continue on the existing branch instead of creating a duplicate branch.
- Never commit directly to `main`. Open a pull request for review after the branch is pushed.
- Keep commits focused. Do not include unrelated local changes, generated databases, `.env.local`, or workspace contents.
- Before opening a PR, run `pnpm typecheck` and `pnpm lint`; include any failures or skipped checks in the PR body.
- For UI changes, include a short visual verification note in the PR body with the important viewport(s) or interaction states checked.

## Environment

`.env.local` (gitignored) needs:

```
OPENROUTER_API_KEY=sk-or-v1-...
DEFAULT_MODEL=deepseek/deepseek-v4-flash
WORKSPACE_ROOT=./workspace
DATABASE_URL=./anton.db
```

Never log the API key. Never commit `.env.local`, `anton.db`, or anything under `workspace/`.

## Conventions

- Prefer editing existing files over creating new ones; do not scaffold files "for later".
- Do not create test files or write test cases. Use typechecking, linting, builds, and focused manual verification instead.
- No default exports for components — named exports only.
- Server-only code never imports from `components/` or `app/` client code; client components never import from `src/db/` or `src/agent/`.
- Tool definitions are `tool({ description, inputSchema: z.object({...}), execute })`. Keep them pure; side-effects live in `execute`. Native tool approval metadata is applied centrally in `src/agent/permissions.ts`; MCP tool wrappers still carry `needsApproval: true`.
- UI renders messages from `message.parts` (v6 UIMessage shape), not `message.content`. Tool calls render as collapsible cards, never as raw JSON.
- Streaming custom data (permission requests, tool progress) uses AI SDK custom data parts through `toUIMessageStreamResponse`, not ad-hoc JSON frames.
- Comments explain **why**, not what. Default is no comment.

## Roadmap

See `ROADMAP.md` for shipped capability, known gaps, and future implementation tasks. Use it when choosing work, creating GitHub issues, and marking completed items after issues are resolved.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
