# Anton vs. other coding-agent harnesses

This document compares Anton's harness architecture with Claude Code, OpenAI Codex CLI, OpenCode, and Aider-style tools. The Anton sections describe code in this repository. The descriptions of other tools are approximate, high-level summaries from their public documentation and general knowledge. Their source is not in this repo, they change often, and they should not be read as exact specifications.

For the stack, layout, and conventions see [`AGENTS.md`](../AGENTS.md). For shipped work and known risks see [`ROADMAP.md`](../ROADMAP.md).

## TL;DR

| Axis | Anton | Typical CLI harness (Claude Code / Codex CLI / OpenCode / Aider) — approximate |
|---|---|---|
| Form factor | Next.js web app: `/api/chat` route, SSE stream, SQLite | Terminal TUI or CLI process. OpenCode also has a client/server split. |
| Loop driver | AI SDK `streamText` with `prepareStep` / `stopWhen` hooks | Usually a hand-written loop: call the model, run tools, repeat |
| Modes | About 10 run profiles, each with its own step, token, and cost caps; a run can be promoted to a larger profile while it runs | A few modes (for example plan/act, ask/code/architect) plus a global turn or step limit |
| Safety | Path sandbox, approval metadata for each tool, and a classifier for `bash` commands. No OS-level confinement. | Claude Code: permission modes and allow/deny rules. Codex CLI: OS sandbox (Seatbelt / Landlock + seccomp). |
| Observability | Runs, tool calls, approvals, events, and context summaries are stored in relational tables | Usually transcript or session files, plus optional telemetry or hooks |
| Loop guards | A stateful policy engine that blocks duplicate calls, tracks phases, and forces a final answer | Mostly step or turn limits, sometimes with simple repetition detection |

## Anton's harness, part by part

### 1. Entry point — `app/api/chat/route.ts`

One `POST` handler does all of the orchestration before the model sees any tokens:

- **Validation.** The request body is parsed with a Zod schema (`bodySchema.safeParse`). Invalid requests are rejected before any side effects.
- **Run-profile resolution.** `resolveRunProfile()` picks the profile in this order: a profile-handoff target, then the profile of the run that an approval continuation came from, then `classifyRunProfileFromMessages(mode, messages)`. Accepted-plan runs are narrowed further by `refineAcceptedPlanProfile()`.
- **Concurrency and consistency guards** (all return HTTP `409`):
  - *History conflict.* The request is rejected if the client's message history differs from the stored history ("session message history changed; refresh before sending again").
  - *One active run per session.* The request is rejected if `getActiveRunForSession()` finds a run that is not stale ("session already has a running agent turn").
  - *Duplicate handoff continuation.* The request is rejected if a continuation for the same handoff run already exists.
- **Context budgeting.** `budgetMessagesForModel()` trims history to fit the profile's `RunBudget`. If it drops messages, the route builds a dropped-history digest (`buildDroppedHistoryDigest`) and adds it to the model-only context message, then budgets again. Context that stays the same for the whole run (slash skill, single-file target, continuation note) goes into the system prompt so it is part of the cacheable prefix.
- **Run row and streaming.** The route creates a `runs` row, then streams the agent's output to the browser as AI SDK UI message parts over SSE with `createUIMessageStream` / `createUIMessageStreamResponse`.

### 2. Agent loop — `src/agent/loop.ts`

Anton does **not** implement its own `while` loop. It calls the Vercel AI SDK's `streamText`, which runs the multi-step tool loop. Anton's own behavior comes in through these hooks:

- **`stopWhen: [profileHandoffStopCondition, stepCountIs(budget.maxSteps)]`.** The step cap comes from the profile budget. A custom condition ends fast-edit and `single-file-edit` runs early when `ToolPolicyEngine.checkPromotion()` reports that the task has outgrown its profile. The run then hands off to a larger profile.
- **`prepareStep`.** This runs before every model step and can append corrective assistant messages from the policy engine:
  - verify reminders and verify-fix notes after edits,
  - stale-read notes when a file changed after it was read,
  - a "Loop guard: … Write the final answer now without calling more tools." message when `shouldForceFinal()` or `forceFinalAnswerReason()` fires,
  - deduplication of replayed tool messages (`dedupeToolReplayMessages`),
  - `activeTools` narrowing for each step.
- **Forced `toolChoice`.** `single-file-edit` forces `read_file` on step 0 and `verify` after an edit. Some providers cannot force a tool choice (for example DeepSeek). For those, Anton adds a text nudge instead so the required step still happens.
- **Per-step audits.** `onStepFinish` records a `TokenAudit` for each step and a prompt-cache audit (`buildPromptCacheAudit`).

### 3. Profiles and budgets — `src/agent/run-budget.ts`

`RUN_BUDGETS` defines caps for each `AgentRunProfile`: `pure-chat`, `ask`, `plan`, `accepted-plan-simple`, `accepted-plan-general`, `command-run`, `localized-edit`, `single-file-edit`, `general-chat`, `approval-continuation`. Each profile sets:

- `maxSteps` (1 for `pure-chat`, 5 for `single-file-edit`, 32 for `general-chat`)
- input, output, and total token caps
- `maxCostUsd` ($0.02 to $0.25)
- character limits for injected prior-run and workspace context

`budgetForProfile()` derives byte limits and sanity caps from these values. Each profile also gets its own set of native tools (`PROFILE_NATIVE_TOOLS`). MCP tools are loaded only for `general-chat`, or for a fast-edit start in `full-access` mode (`profileAllowsMcp`).

**Runtime promotion.** `ToolPolicyEngine.checkPromotion()` uses `evaluateFastEditPromotion()`, which looks at how many distinct paths were read, partial reads, failed edits, search steps before the first edit, and whether any edit succeeded. If it decides a small edit profile is no longer enough, the run hands off to a larger profile such as `general-chat` and continues there.

### 4. Tool policy engine — `src/agent/tool-policy.ts`

`ToolPolicyEngine` is a stateful watchdog for each run. It moves through the phases `explore → (recoverEdit) → postEdit → verify → final`. It tracks:

- read counts per path and per line range
- search counts
- edited paths
- failed edits per path
- verify results

Every native and MCP tool call goes through `checkBeforeExecute()`. It can:

- block a repeated call with identical input ("Use the latest result instead of calling it again")
- block reads or searches that do not fit the current phase
- enforce the profile's tool restrictions

A blocked call returns a structured `LOOP_GUARD_BLOCKED` result to the model; the harness does not throw. The engine also emits loop-guard events for the UI and the event log, with throttling through `shouldEmitLoopGuardEvent`. If blocks keep repeating, `shouldForceFinal()` forces a final answer. The engine can be seeded from earlier tool history (`seedFromPriorToolHistory`), so approval and handoff continuations keep its state.

### 5. Tool registry — `src/agent/tools/index.ts`

There are 34 native tools: file read and edit variants, file operations, `format`, git tools, `bash`, `inspect_project`, `verify`, `grep`, `glob`, memory, skills, `delegate_task`, and `update_todos`. `createAntonTools()` binds each one to the session's workspace root and wraps it in layers:

1. **Permission flags.** `applyNativeToolPermissionPolicy(tools, permissionMode)` sets `needsApproval` based on the permission mode.
2. **Execution cache.** `withExecutionCache` keys results by `name:toolCallId`. It also dedupes concurrent calls by `name:stableJson(input)`, so identical calls in the same step run only once.
3. **Policy wrapper.** `withToolPolicy` runs `toolPolicy.checkBeforeExecute()` before every `execute`.

MCP tools are merged into the same set when the profile allows them. They keep `needsApproval: true` except in `full-access` mode.

### 6. Permissions — `src/agent/permissions.ts`

- **Three modes:**
  - `default`: every native tool needs approval.
  - `auto-review`: only tools whose static metadata has `requiresApproval` need approval.
  - `full-access`: no approval prompts, and the `bash` command policy is advisory only.
- **Static risk categories** for each tool: `read-only`, `write`, `delete`, `network`, `package-install`, `git`, `long-running-process`, `external-integration`. A tool without metadata throws at registration time.
- **Approval metadata** (`ToolApprovalMetadata`) gives the UI:
  - a title, summary, details, and target
  - `diffPreview` (previous and next text) for write and edit tools
  - for `bash`: the command, cwd, timeout, output cap, workspace boundary, and the `BashCommandClassification`
  - for MCP tools: the server and tool name, and a `sandboxedByAnton` flag

### 7. Sandbox — `src/agent/sandbox.ts` and `src/agent/command-policy.ts`

- `resolveInWorkspace()` rejects an empty path, an absolute path, any path that resolves outside the root (for example through `..`), and any symlink escape. It checks the symlink case by resolving the real path of the nearest existing ancestor, which also covers files that do not exist yet. Workspace roots themselves are validated: the root cannot be the Anton source directory, a filesystem root, `$HOME`, or a path inside `.git`, `node_modules`, `.next`, `dist`, or `build`.
- `bash` commands go through `evaluateBashCommandPolicy()` before they run. It tokenizes shell operators and redirections and classifies the command's risk categories. It rejects:
  - `sudo` / `su`
  - commands that print the environment
  - reads of secret-like files
  - destructive targets
  - git policy violations
  - absolute paths
  - redirection outside the workspace
  - shell syntax it cannot analyze safely

  The command then runs through `execa` (via `src/workspace/process-runner.ts`) with:
  - `cwd` set to the workspace root
  - a timeout (180 s by default)
  - a 64 KiB output cap
  - an environment allowlist (`buildBashEnvironment`)
  - output redaction (`src/lib/redaction.ts`)
- **There is no OS-level confinement.** `ROADMAP.md` lists this under *Known Implementation Risks*. The `full-access` approval text also says "OS confinement is not provided." A command that passes the classifier runs with the server process's user privileges.

### 8. Persistence — `src/db/schema.ts`

SQLite (WAL) through Drizzle holds a relational audit trail:

| Table | What it records |
|---|---|
| `sessions`, `messages` | Conversation state and the UI message transcript |
| `runs` | One row per agent turn: model, provider, status, timings, tokens, cost, `cost_metadata` (profile, handoff, audits), step count, finish reason |
| `tool_calls` | Each tool invocation: step number, status, input and output summaries, approval decision, exit code, error, duration |
| `tool_approvals` | Each approval request and response: risk categories, full metadata, reason, timestamps |
| `run_events` | Ordered `step` / `reasoning` / `tool` / `approval` / `error` / `progress` events for the run trace UI |
| `run_context_summaries` | Summary, facts, files, commands, and tools for each run, used for prior-run context digests |
| `memories` | Durable project memories |

Other tables hold projects, MCP servers and trust decisions, GitHub installations, and background command sessions.

## Comparison by axis

### 1. Form factor: web-app backend vs. terminal CLI

Anton is a self-hosted agent backend that has a browser UI. One request (`POST /api/chat`) is one run. Its state is in SQLite and it streams to the client over SSE. Because a server and many clients are involved, it needs safeguards a CLI does not: 409 checks for history conflicts and for more than one active run, approval continuations that arrive as new HTTP requests, and runs marked stale when the client goes away.

*Approximate peers:*
- **Claude Code** and **Codex CLI** run as local TUI processes. The session lives in process memory and in local transcript files.
- **OpenCode** separates a server from its TUI client, so in that respect it is closest to Anton. Its persistence is file-based rather than relational, as far as public docs show.
- **Aider** is a single-process CLI built around git commits.

### 2. Loop driver: `streamText` hooks vs. hand-written loops

Anton gives the multi-step loop to the AI SDK and changes its behavior only through `prepareStep` (messages, `activeTools`, `toolChoice`) and `stopWhen`. This keeps the loop code small and works with any provider the SDK supports. The trade-off is that changes to the loop have to go through the SDK's hook points. Anton cannot, for example, pause the loop between tool execution and the next model call unless a hook allows it.

*Approximate peers:* Claude Code, Codex CLI, and Aider are generally described as having their own agent loops: call the model, parse tool calls or edits, run them, and append the results. OpenCode is also built on the AI SDK, so its loop is probably closer to Anton's.

### 3. Profiles and budgets: many small profiles vs. a mode toggle

Anton classifies each request into one of about 10 profiles. Each has its own step, token, and cost caps and its own tool set, and a small edit profile can be promoted to `general-chat` while it runs. As a result, a trivial edit cannot spend a general-chat budget, and a task that was under-scoped can still finish.

*Approximate peers:*
- Claude Code: plan mode vs. normal mode, plus a max-turns setting.
- Codex CLI: approval presets.
- OpenCode: built-in agents such as build and plan.
- Aider: ask, code, and architect chat modes.

These usually set the tools and approval behavior. Budgets are usually global, and the harness rarely reclassifies a task while it is running.

### 4. Safety model

Anton's controls are all in user space:
- a path sandbox for every file tool
- static risk categories and detailed approval metadata (diffs, command classification) for each tool
- a heuristic `bash` classifier
- an environment allowlist, timeout, and output cap

The OS does not enforce any of this. A `bash` command that passes the classifier runs with the server user's privileges.

*Approximate peers:*
- **Claude Code** has permission modes (for example default, accept-edits, plan, bypass) and settings-based allow/deny rules for each tool or command pattern. Recent versions add optional OS-level sandboxing for bash.
- **Codex CLI** is known for OS-level sandboxing: Seatbelt on macOS and Landlock plus seccomp on Linux. Combined with approval policies and network restrictions, it confines writes and network access at the kernel level.
- **OpenCode** and **Aider** mostly use confirmation prompts and permission config, without kernel confinement.

So Anton's approval UX is detailed, but on containment it is behind Codex. Adding OS confinement is an open item on the roadmap. Running Anton in Docker reduces the risk in the meantime.

### 5. Observability and audit

Anton stores every run, tool call, approval decision, event, and context summary in normalized tables with foreign keys. This makes it possible to query cost per profile, approval history, tool failure rates, or a full ordered trace of any past run without extra infrastructure. The run-trace UI reads from these tables.

*Approximate peers:* CLI harnesses usually keep JSON or JSONL session transcripts and may offer OpenTelemetry export or hooks (for example Claude Code hooks and telemetry). Their data is good for resuming a session. Cross-run analysis usually means post-processing the files.

### 6. Loop guards

Anton's guards understand what the agent is doing. `ToolPolicyEngine`:
- blocks identical repeated calls and redundant reads or searches based on the phase
- adds stale-read and verify reminders
- returns structured `LOOP_GUARD_BLOCKED` results the model can react to
- forces a final answer when recovery attempts run out

`withExecutionCache` also dedupes identical concurrent calls within a step.

*Approximate peers:* Most harnesses mainly rely on a max-turns or step limit, context compaction, and user interrupts. Some detect simple repetition. Phase-aware blocking and forced-final nudges are less common, as far as public documentation shows.

## Where Anton is intentionally simpler

- No OS sandbox (see above).
- A single-user, local deployment model. There is no multi-tenant isolation.
- `delegate_task` is a bounded, read-only sub-agent. Peers like Claude Code have more general sub-agent and task systems.
