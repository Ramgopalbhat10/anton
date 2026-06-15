# Anton Roadmap

Last reviewed: 2026-05-25

This roadmap is the working backlog for turning Anton from a learning harness into a reliable local AI coding agent. Use each checklist item as the source for future GitHub issues. Mark finished items as `[✔️]` after the related GitHub issue or PR is resolved.

## Current Baseline

- [✔️] Next.js 16 App Router application with React 19 and TypeScript strict mode.
- [✔️] Tailwind CSS v4 dark UI using shadcn-style primitives.
- [✔️] OpenRouter provider integration through Vercel AI SDK v6.
- [✔️] Streaming chat endpoint at `/api/chat` using `streamText`.
- [✔️] Multi-step tool loop bounded by profile-aware step budgets.
- [✔️] SQLite persistence through `better-sqlite3` and Drizzle ORM.
- [✔️] Session persistence with title, selected model, token total, and messages.
- [✔️] Basic markdown rendering for assistant messages.
- [✔️] Tool calls rendered as UI parts instead of raw JSON.
- [✔️] Tool approval flow using AI SDK approval response parts.
- [✔️] Diff display for `write_file` tool output.
- [✔️] Token counter displayed in the chat composer/header UI.
- [✔️] Project memories with create, list, update, delete support.
- [✔️] Workspace-local skills discovery and reading from `skills/<slug>/SKILL.md`.
- [✔️] Read-only delegate sub-agent for bounded investigation.
- [✔️] MCP tool loading from workspace `.mcp.json`.

## Latest Implemented Work

- [✔️] Added persistent workspace settings for local GitHub-backed project roots.
- [✔️] Added GitHub App configuration helpers and installation-token flow.
- [✔️] Added GitHub installation callback persistence.
- [✔️] Added repository listing across connected GitHub App installations.
- [✔️] Added project persistence for cloned GitHub repositories.
- [✔️] Added local clone/fetch flow for GitHub repositories using installation tokens.
- [✔️] Added project APIs for listing, creating, and fetching projects.
- [✔️] Added workspace settings API for reading and updating local workspace root.
- [✔️] Added session-to-project association through `projectId`.
- [✔️] Made new chat sessions require a ready project before agent execution.
- [✔️] Passed selected project `localPath` into the agent tool sandbox.
- [✔️] Updated native tools to accept a per-session workspace root.
- [✔️] Updated MCP and skills loading to use the active project workspace.
- [✔️] Added Settings UI for workspaces, memories, and skills.
- [✔️] Added GitHub repository clone/select UI.
- [✔️] Added active project selection backed by local storage.
- [✔️] Added collapsible sidebar.
- [✔️] Added Worklog panel for tool activity, approvals, inputs, outputs, and diffs.
- [✔️] Added persistent run metadata and ordered run events for `/api/chat` executions.
- [✔️] Added Devin/Codex-style inline reasoning and activity traces above assistant responses.
- [✔️] Added provider reasoning streaming support while filtering trace data out of model replay.
- [✔️] Updated Worklog and inline traces to share normalized trace helpers for consistent tool, approval, and timing UI.
- [✔️] Added durable tool-call and approval audit rows tied to chat runs.
- [✔️] Added provider, step-count, and cost metadata tracking for runs.
- [✔️] Added profile-aware context budgeting, transcript pruning, and step/token run budgets.
- [✔️] Added GitHub project metadata refresh.
- [✔️] Added GitHub installation/account filtering in Workspaces settings.
- [✔️] Added right-sidebar PR view detection for active GitHub project branches.
- [✔️] Added branch switch/create controls in the composer and workspace settings.
- [✔️] Added project Status worklog tab with path, git state, package manager, scripts, and last run metadata.
- [✔️] Added Agent defaults settings for model, max steps cap, and approval strictness with server-side enforcement.
- [✔️] Polished trace workspace file tabs, headers, and Pierre code view scrolling/gutter behavior.
- [✔️] Synced file tree git status badges with local `git status`, including header dirty counts and refresh on focus.
- [✔️] Replaced global active-project localStorage with session-scoped composer project picker that locks after the first message (#107).
- [✔️] Kept chat, Worklog, and Status reasoning traces aligned across live and persisted run views.
- [✔️] Made verification run independent targets in staged order with build-safe timeout reporting (#134, #175).
- [✔️] Hardened verification classification and post-edit rollback for cache-safe agent recovery.
- [✔️] Enriched prior-run context summaries with todos, verification, blockers, touched files, and failed tool details (#136).
- [✔️] Reduced live trace rendering pressure with lazy-mounted disclosures and bounded running Worklog rows (#139).
- [✔️] Hardened native grep fallback search and rendered grep results as structured Worklog output (#140).
- [✔️] Added OpenRouter model catalog, provider routing settings, and routing cache metadata (#142).
- [✔️] Hardened chat message validation, compact model-visible tool outputs, and MCP startup warnings (#144).

## Phase 1: Trust Boundaries And Safety

- [✔️] Replace scattered `needsApproval` usage with a central server-side permission policy.
- [✔️] Classify tools and commands by risk: read-only, write, delete, network, package install, git, long-running process, and external integration.
- [✔️] Add per-tool and per-command approval metadata that explains exactly what will happen before execution.
- [✔️] Require explicit approval before starting stdio MCP servers, not only before invoking MCP tools.
- [✔️] Add a trust store for approved MCP server configs, commands, environment variables, and workspace roots.
- [✔️] Scrub shell environment by default and pass only an allowlist of required variables.
- [✔️] Add command policy checks for absolute paths, shell redirection outside workspace, destructive filesystem operations, network access, and secret-printing commands.
- [✔️] Replace the current `sudo`/`su` denylist with a parser-backed or policy-backed command classifier.
- [✔️] Harden parser-backed shell command policy against complex shell syntax, redirection escapes, destructive git/force-push commands, and nested shell bypasses (#160).
- [✔️] Add secret redaction for tool inputs, tool outputs, logs, and UI rendering.
- [✔️] Add workspace-root validation that prevents using Anton source, `.git`, dependency folders, build output, system directories, and user home as agent workspaces.
- [✔️] Harden sandbox traversal, symlink escape, workspace root validation, and command policy behavior.

## Phase 2: Real Coding-Agent Editing

- [✔️] Add a patch-based edit tool and make it the default editing primitive.
- [✔️] Keep `write_file` only for new small files; route existing-file edits through patch-first tools.
- [✔️] Add atomic writes with conflict detection based on previous file hash or version.
- [✔️] Show proposed diffs before approval, not only after `write_file` completes.
- [✔️] Add file operation tools: `read_dir`, `stat`, `mkdir`, `delete`, `rename`, and `copy`.
- [✔️] Add guardrails for binary files, generated files, lockfiles, migrations, and large files.
- [✔️] Add formatting integration that follows the target repo package manager and scripts.
- [✔️] Add a revert-last-agent-change workflow based on git diff or tool-call history.
- [✔️] Add first-class git tools for `status`, `diff`, `show`, `branch`, `commit`, and `restore` with scoped approvals.

## Phase 3: Durable Runs And Audit Trail

- [✔️] Add `runs` table for each `/api/chat` execution.
- [✔️] Add durable `run_events` for ordered reasoning, tool, approval, progress, and error trace rows.
- [✔️] Add `tool_calls` table with tool name, input summary, approval decision, output summary, timestamps, exit code, and error state.
- [✔️] Add `approvals` table or structured approval fields tied to tool calls.
- [✔️] Persist Worklog from database state instead of reconstructing from message parts and trace data.
- [✔️] Stop replacing entire message transcripts on every finish; append messages or use optimistic concurrency.
- [✔️] Add concurrency protection for two browser tabs writing the same session.
- [✔️] Add indexes for `messages.session_id`, `sessions.updated_at`, `sessions.project_id`, `projects.github_repo_id`, and `memories.updated_at`.
- [✔️] Track model, usage, finish reason, and abort/error status for each run.
- [✔️] Add database migrations for run and run-event persistence changes.
- [✔️] Track provider, step count, and cost metadata for each run.

## Phase 4: Agent Loop Quality

- [✔️] Add structured todo/planning state for multi-step coding tasks.
- [✔️] Add explicit handling when the model reaches the max-step limit.
- [✔️] Add automatic verification policy after edits: detect package manager, run typecheck, lint, and build when appropriate.
- [✔️] Add stack/repo inspection summary before the first coding action in a project.
- [✔️] Add token-audit metadata, run profiles, filtered tool definitions, MCP gating, and accepted-plan context compaction.
- [✔️] Add profile-aware context budgeting and transcript pruning.
- [✔️] Add repo map, recent diff summary, and selected file summaries for richer context selection.
- [✔️] Add model selection validation on the server; reject unsupported or disabled model IDs.
- [✔️] Add enforceable per-run token and step budgets.
- [✔️] Add enforceable dollar-cost budgets after reliable model pricing metadata is available.
- [✔️] Add resumable runs after tool approval, refresh, or network interruption.
- [✔️] Add better system prompts for coding workflow: inspect, plan, edit, verify, summarize.
- [✔️] Add final response structure that reports changed files, verification, and unresolved risks.
- [✔️] Add task-scale routing, cache-aware loop control, localized edit recovery, and proportional verification (#118).

## Phase 5: GitHub And Project Workflow

- [✔️] Support importing existing local repositories without cloning from GitHub.
- [✔️] Support refreshing project metadata from GitHub.
- [✔️] Support multiple installations and account filtering in the UI.
- [✔️] Add project removal/archive behavior without deleting local files by default.
- [✔️] Add branch creation with default `codex/` prefix for agent work.
- [✔️] Add PR creation flow after successful local changes.
- [✔️] Add issue selection and branch naming from GitHub issues.
- [✔️] Add right-sidebar PR view for active GitHub project branches.
- [✔️] Add GitHub check/CI status display for pushed branches and PRs.
- [✔️] Add retry/debug workflow for failing GitHub Actions logs.
- [✔️] Store GitHub token expiry metadata and refresh tokens only when needed.

## Phase 6: Developer Experience

- [✔️] Add file tree and file search panel for the active project.
- [✔️] Add project status panel showing root path, git branch, dirty files, package manager, scripts, and last run.
- [✔️] Add expandable run details for project last run.
- [✔️] Add live terminal output streaming for long-running commands.
- [✔️] Add cancellable background command sessions for dev servers and watchers.
- [] Add command history with rerun support.
- [✔️] Add settings for default model, max steps, approval strictness, and workspace root.
- [] Add mobile-friendly workspace and worklog controls.
- [] Add accessible keyboard navigation for settings, sessions, worklog, approvals, and message actions.
- [✔️] Split chat UI components into feature-oriented folders.
- [✔️] Split oversized feature components into focused files.
- [✔️] Consolidate client state and feature API hooks.
- [✔️] Clean up shared UI primitives after modularization.
- [✔️] Replace duplicate workspace/settings UI paths with one canonical Settings implementation.
- [✔️] Clean up layout formatting and UI polish issues that are not core behavior.
- [✔️] Adopted the `design/mockups.pen` design-system theme: layered neutral surface tokens, orange accent, Inter + JetBrains Mono fonts, and the redesigned Settings shell and Workspaces screen (#166).
- [✔️] Redesigned the PR right-sidebar (header, sub-tabs, Changes/Description/Discussion/Commits/Checks, and the PR switcher) against `design/mockups.pen`, including `@pierre/diffs` diff-body theming (#169).
- [] Fix project file code view scrollbar corner styling when both scrollbars are visible.

## Phase 7: Evaluation

- [] Add agent eval tasks: add a small feature, refactor safely, deny dangerous command, and summarize existing code.
- [] Add CI workflow running typecheck, lint, and build.
- [] Add manual verification checklists for chat, settings, GitHub repository listing states, project selection, approvals, worklog, and diff rendering.

## Phase 8: Documentation And Operating Model

- [✔️] Update `README.md` to point to this roadmap and remove the old five-phase completed roadmap.
- [✔️] Update `AGENTS.md` and `CLAUDE.md` to use `ROADMAP.md` as the source for implementation tasks and roadmap completion updates.
- [] Document the current architecture in `docs/architecture.md`.
- [] Add ADR for workspace/project separation and why target repos live outside Anton source.
- [] Add ADR for permission policy and tool-risk classification.
- [] Add ADR for GitHub App authentication and local clone strategy.
- [] Add setup guide for GitHub App environment variables.
- [] Add local development guide for migrations, workspaces, and sample data.
- [] Add contributor guide for turning roadmap items into GitHub issues.
- [] Add security notes covering tool execution, workspace trust, MCP trust, and secrets handling.

## Known Implementation Risks

- [✔️] Chat message input is still validated as `z.array(z.unknown())` before casting to `AntonUIMessage[]`.
- [] Normal permission modes still use heuristic shell command classification; `full-access` intentionally treats command policy as advisory only.
- [] Workspace process execution is centralized around cwd, environment allowlist, timeouts, output caps, and redaction, but does not provide OS-level confinement yet.
- [✔️] MCP stdio server startup can execute configured commands before user approval.
- [✔️] Full-file `write_file` replacement risk is resolved by patch-first editing.
- [✔️] Message persistence still deletes and reinserts the full session transcript in some recovery paths.
- [] GitHub clone/fetch runs synchronously inside request handling and may exceed request duration for large repositories.
- [] Installation tokens are injected into git through extra headers; keep redaction behavior current as clone/fetch behavior evolves.
- [] New chats require explicit project selection; there is no default or durable user/workspace project preference yet.
