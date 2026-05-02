# Claude Code instructions

Follow the shared agent rules in `AGENTS.md`:

@AGENTS.md

## Claude-specific notes

- Use the `TodoWrite` tool to track any task that takes more than ~3 steps. Mark items `completed` as soon as they are done; do not batch.
- When a task spans many files, prefer a single `Agent` delegation with `subagent_type: "Explore"` over many serial reads.
- Run `pnpm typecheck` and `pnpm lint` before reporting a coding task as done. A green build is the acceptance criterion.
- Before writing Next.js code, consult `node_modules/next/dist/docs/`; this project pins Next 16, which has breaking changes from older training data.
- Before implementation, create or identify the GitHub issue for the work and keep the branch/PR tied to that issue.
- For new implementation work, create a fresh `claude/*` feature branch before editing. If the change belongs to an existing branch, update that branch from `main` first and continue there.
- Never push to `main`. Work on `claude/*` feature branches and open PRs only when explicitly asked.
- Never commit `.env.local`, `anton.db`, `anton.db-shm`, `anton.db-wal`, or anything under `workspace/`.
