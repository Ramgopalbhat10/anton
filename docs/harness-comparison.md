# Anton vs. other coding-agent harnesses

How Anton's harness compares with Claude Code, Codex CLI, OpenCode, and Aider. The Anton sections describe code in this repo. The descriptions of other tools are approximate summaries from public docs — not exact specifications.

## TL;DR

| Axis | Anton | Typical CLI harness — approximate |
|---|---|---|
| Form factor | Next.js web app: `/api/chat` route, SSE stream, SQLite | Terminal TUI or CLI process. OpenCode also has a client/server split. |
| Loop driver | AI SDK `streamText` with `prepareStep` / `stopWhen` hooks | Usually a hand-written loop: call the model, run tools, repeat |
| Modes | ~10 run profiles, each with step, token, and cost caps; a run can be promoted to a larger profile mid-run | A few modes (plan/act, ask/code/architect) plus a global turn limit |
| Safety | Path sandbox, per-tool approval metadata, `bash` command classifier. No OS-level confinement. | Claude Code: permission modes + allow/deny rules. Codex CLI: OS sandbox (Seatbelt / Landlock + seccomp). |
| Observability | Runs, tool calls, approvals, and events in relational tables | Transcript or session files, plus optional telemetry |
| Loop guards | Stateful policy engine: blocks duplicate calls, tracks phases, forces a final answer | Mostly step limits, sometimes simple repetition detection |

## Anton's harness, part by part

### 1. Entry point — `app/api/chat/route.ts`

One `POST` handler does all orchestration before the model runs:

- Validates the body with Zod, then `resolveRunProfile()` picks the profile (handoff target → approval-continuation profile → `classifyRunProfileFromMessages`).
- Returns `409` on history conflicts, an already-active run, or a duplicate handoff continuation.
- `budgetMessagesForModel()` trims history to the profile's `RunBudget`; dropped history becomes a digest in the context message. Run-stable context goes into the system prompt for prompt caching.
- Creates a `runs` row and streams AI SDK UI message parts over SSE.

### 2. Agent loop — `src/agent/loop.ts`

Anton does not hand-write a loop — `streamText` runs it. Anton hooks in via:

- `stopWhen`: profile step cap plus a custom condition that ends small-profile runs when `checkPromotion()` says the task outgrew them.
- `prepareStep`: injects verify reminders, stale-read notes, forced-final nudges, dedupes replayed tool messages, and narrows `activeTools` per step.
- Forced `toolChoice` for `single-file-edit` (text nudge fallback for providers without tool forcing, e.g. DeepSeek).
- `onStepFinish`: per-step token and prompt-cache audits.

### 3. Profiles and budgets — `src/agent/run-budget.ts`

`RUN_BUDGETS` sets per-profile `maxSteps` (1 for `pure-chat`, 32 for `general-chat`), token caps, `maxCostUsd` ($0.02–$0.25), and context limits. Each profile gets its own tool set via `PROFILE_NATIVE_TOOLS`; MCP tools load only for `general-chat` or `full-access` fast-edit starts (`profileAllowsMcp`).

`checkPromotion()` → `evaluateFastEditPromotion()` watches paths read, failed edits, and search steps; when a small profile is insufficient, the run hands off to a larger one.

### 4. Tool policy engine — `src/agent/tool-policy.ts`

A stateful watchdog per run, moving through `explore → (recoverEdit) → postEdit → verify → final`. Via `checkBeforeExecute()` it can block repeated identical calls, reads/searches that don't fit the phase, or tools outside the profile — returning a structured `LOOP_GUARD_BLOCKED` result rather than throwing. Repeated blocks trigger `shouldForceFinal()`. State survives continuations via `seedFromPriorToolHistory`.

### 5. Tool registry — `src/agent/tools/index.ts`

34 native tools (file ops, git, `bash`, `verify`, `grep`, `glob`, memory, skills, `delegate_task`, `update_todos`, ...). Each is wrapped in three layers: permission flags (`applyNativeToolPermissionPolicy`), an execution cache (`withExecutionCache` keys by `toolCallId`, dedupes concurrent identical calls), and the policy wrapper (`withToolPolicy`).

### 6. Permissions — `src/agent/permissions.ts`

Three modes: `default` (every native tool needs approval), `auto-review` (only tools flagged `requiresApproval`), `full-access` (no prompts; `bash` policy advisory only). Every tool declares static risk categories or registration throws. Approval metadata gives the UI titles, diff previews, and for `bash` the command classification.

### 7. Sandbox — `src/agent/sandbox.ts` + `src/agent/command-policy.ts`

`resolveInWorkspace()` rejects paths escaping the root (including via symlink or not-yet-existing ancestors) and rejects dangerous workspace roots (`.git`, `node_modules`, `$HOME`, ...). `evaluateBashCommandPolicy()` tokenizes shell syntax and rejects `sudo`, env printing, secret-file reads, destructive targets, absolute paths, out-of-workspace redirection, and unparseable syntax. `bash` runs via `execa` with workspace `cwd`, a 180 s timeout, a 64 KiB output cap, an env allowlist, and output redaction.

**No OS-level confinement** — a command that passes the classifier runs with the server user's privileges. Listed under *Known Implementation Risks* in `ROADMAP.md`.

### 8. Persistence — `src/db/schema.ts`

SQLite (WAL) via Drizzle: `sessions`/`messages` for the transcript, `runs` (model, status, tokens, cost, finish reason), `tool_calls` (inputs, outputs, approval decisions, durations), `tool_approvals`, `run_events` for the trace UI, `run_context_summaries` for prior-run digests, `memories` for durable facts.

## How it compares

- **Form factor.** Anton is a web backend: one request = one run, shared state in SQLite. That forces guards CLIs don't need (409 conflicts, stale runs, approval continuations as new HTTP requests). OpenCode's server/TUI split is closest; Claude Code, Codex CLI, and Aider are single local processes.
- **Loop.** Peers mostly hand-write their loops; Anton (like OpenCode) builds on the AI SDK, so loop changes must go through its hook points.
- **Budgets.** Peers offer a mode toggle plus a global turn cap; Anton reclassifies mid-run, so a trivial edit can't burn a general-chat budget.
- **Safety.** Anton's approval UX is detailed but everything is user-space — no kernel confinement, behind Codex CLI's Seatbelt/Landlock sandbox. Running in Docker mitigates.
- **Observability.** Relational tables make cost-per-profile, approval history, and full run traces queryable; CLIs keep JSONL transcripts that need post-processing.
- **Loop guards.** Phase-aware blocking and forced-final nudges are less common than plain max-turn limits.

## Where Anton is intentionally simpler

- No OS sandbox.
- Single-user local deployment; no multi-tenant isolation.
- `delegate_task` is a bounded, read-only sub-agent — peers have more general task systems.
