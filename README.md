# Anton

A mini AI coding agent harness - built as a learning project to understand how production AI agent systems (Claude Code, Codex, Devin, Hermes, OpenClaw) work under the hood.

## Stack

- **Framework**: Next.js 16 (App Router, Turbopack) + TypeScript (strict)
- **UI**: Tailwind CSS v4 + shadcn conventions
- **LLM layer**: Vercel AI SDK v6 with OpenRouter provider (300+ models via one key)
- **Database**: SQLite (`better-sqlite3`) + Drizzle ORM
- **Tooling runtime**: Node.js (`execa` for shell)

## Getting started

```bash
pnpm install
cp .env.example .env.local          # then edit OPENROUTER_API_KEY
pnpm db:migrate                     # apply Drizzle migrations
pnpm dev                            # http://localhost:3000
```

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Start dev server (Turbopack) |
| `pnpm build` / `pnpm start` | Production build + start |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:generate` | Generate Drizzle migration from schema |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Drizzle Studio |

## Roadmap

- **Phase 0** - scaffold (done)
- **Phase 1** - streaming chat MVP (no tools) (done)
- **Phase 2** - agent loop + tools (`read_file`, `write_file`, `bash`, `grep`, `glob`) + permission gate (done)
- **Phase 3** - persistent sessions (done)
- **Phase 4** - markdown, diff viewer, token counter, QoL (done)
- **Phase 5** - memory / skills / sub-agents / MCP (in progress: project-wide memory and workspace skills)
