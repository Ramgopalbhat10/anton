"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ExternalLink,
  Loader2,
  Play,
  RotateCcw,
  ScrollText,
  Square,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/shared/feedback-states";
import { TerminalOutput } from "@/components/features/run-trace/terminal-output";
import { cn } from "@/lib/utils";
import type {
  BackgroundCommandSessionSummary,
  ProjectStatusSummary,
} from "@/src/lib/api-types";
import { jsonHeaders, requestJson } from "@/src/lib/client-fetch";
import {
  useProjectCommands,
  notifyProjectCommandsChanged,
  type StartBackgroundCommandInput,
} from "@/components/features/projects/hooks";
import { useBackgroundCommandStream } from "@/components/features/projects/use-background-command-stream";

const PRIORITY_SCRIPTS = [
  "dev",
  "start",
  "serve",
  "preview",
  "watch",
  "storybook",
  "test:watch",
] as const;

export function BackgroundCommandsPanel({
  projectId,
  status,
}: {
  projectId: string;
  status: ProjectStatusSummary;
}) {
  const { commands, error, refresh, runningCount } =
    useProjectCommands(projectId);
  const [customCommand, setCustomCommand] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [openLogsId, setOpenLogsId] = useState<string | null>(null);
  const [streamTokens, setStreamTokens] = useState<Record<string, string>>({});

  const runningCommands = commands?.running ?? [];
  const recentCommands = commands?.recent ?? [];
  const activeCommands = new Set(
    runningCommands
      .filter((session) =>
        ["starting", "running", "stopping"].includes(session.status),
      )
      .map((session) => session.command),
  );

  const scriptButtons = useMemo(() => {
    const scripts = new Set(status.scripts);
    const ordered: string[] = [];
    for (const script of PRIORITY_SCRIPTS) {
      if (scripts.has(script)) ordered.push(script);
    }
    for (const script of status.scripts) {
      if (!ordered.includes(script)) ordered.push(script);
    }
    return ordered;
  }, [status.scripts]);

  const runCommand = async (
    input: StartBackgroundCommandInput,
    actionKey: string,
  ) => {
    setPendingAction(actionKey);
    setActionError(null);
    try {
      const data = await requestJson<{
        session: BackgroundCommandSessionSummary;
        streamToken: string;
      }>(`/api/projects/${projectId}/commands`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(input),
      });
      setStreamTokens((current) => ({
        ...current,
        [data.session.id]: data.streamToken,
      }));
      setOpenLogsId(data.session.id);
      notifyProjectCommandsChanged(projectId);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to start command");
    } finally {
      setPendingAction(null);
    }
  };

  const stopCommand = async (session: BackgroundCommandSessionSummary) => {
    setPendingAction(`stop:${session.id}`);
    setActionError(null);
    try {
      await requestJson(`/api/projects/${projectId}/commands/${session.id}/stop`, {
        method: "POST",
        headers: jsonHeaders(),
      });
      notifyProjectCommandsChanged(projectId);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to stop command");
    } finally {
      setPendingAction(null);
    }
  };

  const restartCommand = async (session: BackgroundCommandSessionSummary) => {
    setPendingAction(`restart:${session.id}`);
    setActionError(null);
    try {
      const data = await requestJson<{
        session: BackgroundCommandSessionSummary;
        streamToken: string;
      }>(`/api/projects/${projectId}/commands/${session.id}/restart`, {
        method: "POST",
        headers: jsonHeaders(),
      });
      setStreamTokens((current) => ({
        ...current,
        [data.session.id]: data.streamToken,
      }));
      setOpenLogsId(data.session.id);
      notifyProjectCommandsChanged(projectId);
      await refresh();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to restart command",
      );
    } finally {
      setPendingAction(null);
    }
  };

  const rerunCommand = async (session: BackgroundCommandSessionSummary) => {
    const scriptName = scriptNameFromStoredCommand(session);
    if (session.commandKind === "script" && scriptName) {
      await runCommand({ kind: "script", scriptName }, `rerun:${session.id}`);
      return;
    }
    await runCommand({ kind: "custom", command: session.command }, `rerun:${session.id}`);
  };

  const clearRecent = async () => {
    setPendingAction("clear");
    setActionError(null);
    try {
      await requestJson(`/api/projects/${projectId}/commands`, {
        method: "DELETE",
        headers: jsonHeaders(),
      });
      setOpenLogsId(null);
      notifyProjectCommandsChanged(projectId);
      await refresh();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to clear recent commands",
      );
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section className="border-b border-border px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Commands
        </h3>
        {runningCount > 0 ? (
          <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-emerald-400/30">
            {runningCount} running
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="mb-2">
          <ErrorBanner message={error} />
        </div>
      ) : null}
      {actionError ? (
        <div className="mb-2">
          <ErrorBanner message={actionError} />
        </div>
      ) : null}

      <div className="space-y-3">
        {runningCommands.length > 0 ? (
          <div className="space-y-2">
            {runningCommands.map((session) => (
              <RunningCommandCard
                key={session.id}
                session={session}
                pendingAction={pendingAction}
                logsOpen={openLogsId === session.id}
                streamToken={streamTokens[session.id]}
                projectId={projectId}
                onToggleLogs={() =>
                  setOpenLogsId((current) =>
                    current === session.id ? null : session.id,
                  )
                }
                onStop={() => void stopCommand(session)}
                onRestart={() => void restartCommand(session)}
              />
            ))}
          </div>
        ) : null}

        <CommandGroup title="Scripts">
          {scriptButtons.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {scriptButtons.map((script) => {
                const disabled =
                  activeCommands.has(
                    scriptLaunchCommand(status.packageManager, script),
                  ) || pendingAction === `script:${script}`;
                return (
                  <Button
                    key={script}
                    type="button"
                    size="xs"
                    variant="secondary"
                    disabled={disabled}
                    onClick={() =>
                      void runCommand(
                        { kind: "script", scriptName: script },
                        `script:${script}`,
                      )
                    }
                    className="font-mono text-[10px]"
                  >
                    {pendingAction === `script:${script}` ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Play className="size-3" />
                    )}
                    {script}
                  </Button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No npm scripts detected.</p>
          )}
        </CommandGroup>

        <CommandGroup title="Custom command">
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = customCommand.trim();
              if (!trimmed || activeCommands.has(trimmed)) return;
              void runCommand({ kind: "custom", command: trimmed }, `custom:${trimmed}`);
            }}
          >
            <Input
              value={customCommand}
              onChange={(event) => setCustomCommand(event.target.value)}
              placeholder="python -m http.server"
              className="h-7 font-mono text-[11px]"
            />
            <Button
              type="submit"
              size="xs"
              disabled={
                !customCommand.trim() ||
                activeCommands.has(customCommand.trim()) ||
                pendingAction?.startsWith("custom:") === true
              }
            >
              Run
            </Button>
          </form>
        </CommandGroup>

        <CommandGroup
          title="Recent"
          action={
            recentCommands.length > 0 ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="h-5 px-1.5 text-[10px] text-muted-foreground"
                disabled={pendingAction === "clear"}
                onClick={() => void clearRecent()}
              >
                {pendingAction === "clear" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  "Clear"
                )}
              </Button>
            ) : null
          }
        >
          {recentCommands.length > 0 ? (
            <div className="space-y-2">
              {recentCommands.map((session) => (
                <RecentCommandCard
                  key={session.id}
                  session={session}
                  pendingAction={pendingAction}
                  logsOpen={openLogsId === session.id}
                  streamToken={streamTokens[session.id]}
                  projectId={projectId}
                  rerunDisabled={activeCommands.has(session.command)}
                  onToggleLogs={() =>
                    setOpenLogsId((current) =>
                      current === session.id ? null : session.id,
                    )
                  }
                  onRerun={() => void rerunCommand(session)}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No recent commands.</p>
          )}
        </CommandGroup>
      </div>
    </section>
  );
}

function CommandGroup({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
          {title}
        </h4>
        {action}
      </div>
      {children}
    </div>
  );
}

function RunningCommandCard({
  session,
  pendingAction,
  logsOpen,
  streamToken,
  projectId,
  onToggleLogs,
  onStop,
  onRestart,
}: {
  session: BackgroundCommandSessionSummary;
  pendingAction: string | null;
  logsOpen: boolean;
  streamToken?: string;
  projectId: string;
  onToggleLogs: () => void;
  onStop: () => void;
  onRestart: () => void;
}) {
  const now = useElapsedClock();
  const primaryUrl = session.detectedUrls[0] ?? null;
  return (
    <div className="rounded-md bg-background/25 px-2 py-1.5 ring-1 ring-border/50">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={session.status} />
            <code className="truncate font-mono text-[10px] text-foreground">
              {session.command}
            </code>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span>{formatElapsed(session.startedAt, now)}</span>
            {primaryUrl ? (
              <a
                href={primaryUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sky-400 hover:underline"
              >
                Open
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={onToggleLogs}
            aria-label="View logs"
            title="Logs"
          >
            <ScrollText className="size-3" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={pendingAction === `stop:${session.id}`}
            onClick={onStop}
            aria-label="Stop command"
            title="Stop"
          >
            <Square className="size-3" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={pendingAction === `restart:${session.id}`}
            onClick={onRestart}
            aria-label="Restart command"
            title="Restart"
          >
            <RotateCcw className="size-3" />
          </Button>
        </div>
      </div>
      {logsOpen ? (
        <div className="mt-2">
          <CommandLogViewer
            projectId={projectId}
            session={session}
            streamToken={streamToken}
            live={["starting", "running", "stopping"].includes(session.status)}
          />
        </div>
      ) : null}
    </div>
  );
}

function RecentCommandCard({
  session,
  pendingAction,
  logsOpen,
  streamToken,
  projectId,
  rerunDisabled,
  onToggleLogs,
  onRerun,
}: {
  session: BackgroundCommandSessionSummary;
  pendingAction: string | null;
  logsOpen: boolean;
  streamToken?: string;
  projectId: string;
  rerunDisabled: boolean;
  onToggleLogs: () => void;
  onRerun: () => void;
}) {
  return (
    <div className="rounded-md bg-background/25 px-2 py-1.5 ring-1 ring-border/50">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={session.status} />
            <code className="truncate font-mono text-[10px] text-foreground">
              {session.command}
            </code>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {formatDuration(session.startedAt, session.finishedAt)}
            {session.exitCode !== null ? ` · exit ${session.exitCode}` : null}
            {session.signal ? ` · ${session.signal}` : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={onToggleLogs}
            aria-label="View logs"
            title="Logs"
          >
            <ScrollText className="size-3" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={rerunDisabled || pendingAction === `rerun:${session.id}`}
            onClick={onRerun}
            aria-label="Rerun command"
            title="Rerun"
          >
            <RotateCcw className="size-3" />
          </Button>
        </div>
      </div>
      {logsOpen ? (
        <div className="mt-2">
          <CommandLogViewer
            projectId={projectId}
            session={session}
            streamToken={streamToken}
            live={false}
          />
        </div>
      ) : null}
    </div>
  );
}

function CommandLogViewer({
  projectId,
  session,
  streamToken,
  live,
}: {
  projectId: string;
  session: BackgroundCommandSessionSummary;
  streamToken?: string;
  live: boolean;
}) {
  const [polledSession, setPolledSession] =
    useState<BackgroundCommandSessionSummary>(session);
  const streamState = useBackgroundCommandStream(
    projectId,
    session.id,
    streamToken,
    live && Boolean(streamToken),
  );

  useEffect(() => {
    queueMicrotask(() => setPolledSession(session));
  }, [session]);

  useEffect(() => {
    if (!live || streamToken) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const data = await requestJson<{ session: BackgroundCommandSessionSummary }>(
          `/api/projects/${projectId}/commands/${session.id}`,
        );
        if (!cancelled) setPolledSession(data.session);
      } catch {
        // Keep showing the last known tail when polling fails.
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [live, projectId, session.id, streamToken]);

  const source = live && !streamToken ? polledSession : session;
  const stdout =
    live && streamToken ? streamState.stdout || source.stdoutTail : source.stdoutTail;
  const stderr =
    live && streamToken ? streamState.stderr || source.stderrTail : source.stderrTail;

  return (
    <TerminalOutput
      command={source.command}
      output={{
        stdout,
        stderr,
        exitCode: source.exitCode,
        signal: source.signal,
      }}
    />
  );
}

function StatusBadge({ status }: { status: BackgroundCommandSessionSummary["status"] }) {
  const meta = statusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
        meta.className,
      )}
    >
      {meta.spinner ? <Loader2 className="size-3 animate-spin" /> : null}
      {meta.label}
    </span>
  );
}

function statusMeta(status: BackgroundCommandSessionSummary["status"]) {
  switch (status) {
    case "starting":
      return {
        label: "Starting",
        spinner: true,
        className: "text-amber-400 ring-amber-400/30 bg-amber-400/10",
      };
    case "running":
      return {
        label: "Running",
        spinner: true,
        className: "text-emerald-400 ring-emerald-400/30 bg-emerald-400/10",
      };
    case "stopping":
      return {
        label: "Stopping",
        spinner: true,
        className: "text-amber-400 ring-amber-400/30 bg-amber-400/10",
      };
    case "exited":
      return {
        label: "Exited",
        spinner: false,
        className: "text-muted-foreground ring-border bg-secondary",
      };
    case "failed":
      return {
        label: "Failed",
        spinner: false,
        className: "text-destructive ring-destructive/30 bg-destructive/10",
      };
    case "stopped":
      return {
        label: "Stopped",
        spinner: false,
        className: "text-muted-foreground ring-border bg-secondary",
      };
    case "stale":
      return {
        label: "Stale",
        spinner: false,
        className: "text-amber-400 ring-amber-400/30 bg-amber-400/10",
      };
  }
}

function formatElapsed(startedAt: number | null, now: number): string {
  if (!startedAt) return "—";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}m ${rem}s`;
}

function useElapsedClock(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [intervalMs]);

  return now;
}

function formatDuration(startedAt: number | null, finishedAt: number | null): string {
  if (!startedAt || !finishedAt) return "—";
  const seconds = Math.max(0, Math.floor((finishedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}m ${rem}s`;
}

function scriptLaunchCommand(
  packageManager: ProjectStatusSummary["packageManager"],
  scriptName: string,
): string {
  const pm = packageManager ?? "npm";
  return pm === "npm"
    ? `npm run ${scriptName}`
    : `${pm} run ${scriptName}`;
}

function scriptNameFromStoredCommand(
  session: BackgroundCommandSessionSummary,
): string | null {
  const match = session.command.match(/\b(?:npm|pnpm|yarn|bun)\s+run\s+(\S+)/);
  return match?.[1] ?? null;
}
