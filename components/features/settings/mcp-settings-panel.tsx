"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Check,
  Globe,
  HardDrive,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  Wrench,
  X,
} from "lucide-react";

import { EmptyState, ErrorBanner } from "@/components/shared/feedback-states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  McpServerConfig,
  McpServerSummary,
  McpTransport,
  McpTrustSummary,
  RemoteMcpConfig,
  StdioMcpConfig,
} from "@/src/lib/api-types";
import {
  errorMessage,
  getJson,
  jsonHeaders,
  requestJson,
  requestOk,
} from "@/src/lib/client-fetch";

import { SettingsPageShell } from "./settings-shell";

type Draft = {
  id: string | null;
  displayName: string;
  transport: McpTransport;
  enabled: boolean;
  url: string;
  command: string;
  args: string;
  cwd: string;
  headers: string;
  env: string;
  redirect: "follow" | "error";
};

type PendingTrust = {
  serverId: string;
  trust: McpTrustSummary;
  afterApprove?: () => Promise<void>;
};

type DiscoveredTool = {
  name: string;
  toolName?: string;
  description?: string;
};

const EMPTY_DRAFT: Draft = {
  id: null,
  displayName: "",
  transport: "http",
  enabled: true,
  url: "",
  command: "",
  args: "",
  cwd: "",
  headers: "",
  env: "",
  redirect: "error",
};

export function McpSettingsPanel() {
  const [servers, setServers] = useState<McpServerSummary[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [toolsByServer, setToolsByServer] = useState<
    Record<string, DiscoveredTool[]>
  >({});
  const [pendingTrust, setPendingTrust] = useState<PendingTrust | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getJson<{ servers: McpServerSummary[] }>(
        "/api/mcp/servers",
      );
      setServers(data.servers);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Failed to load MCP servers"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial panel hydration updates state after async requests settle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!testOutput) return;
    const timeout = window.setTimeout(() => setTestOutput(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [testOutput]);

  const selected = useMemo(
    () => servers.find((server) => server.id === draft.id) ?? null,
    [draft.id, servers],
  );
  const selectedTools = draft.id ? toolsByServer[draft.id] ?? [] : [];
  const showEditor = isCreating || draft.id !== null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = draftToRequest(draft);
      const data = draft.id
        ? await requestJson<{ server: McpServerSummary }>(
            `/api/mcp/servers/${draft.id}`,
            {
              method: "PATCH",
              headers: jsonHeaders(),
              body: JSON.stringify(body),
            },
          )
        : await requestJson<{ server: McpServerSummary }>("/api/mcp/servers", {
            method: "POST",
            headers: jsonHeaders(),
            body: JSON.stringify(body),
          });
      setDraft(serverToDraft(data.server));
      setIsCreating(false);
      if (draft.id) {
        setToolsByServer((current) => removeKey(current, draft.id as string));
      }
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to save MCP server"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (server: McpServerSummary) => {
    await requestOk(`/api/mcp/servers/${server.id}`, { method: "DELETE" });
    if (draft.id === server.id) {
      setDraft(EMPTY_DRAFT);
      setIsCreating(false);
    }
    setToolsByServer((current) => removeKey(current, server.id));
    await refresh();
  };

  const test = async (server: McpServerSummary) => {
    setTestingId(server.id);
    setTestOutput(null);
    try {
      const res = await fetch(`/api/mcp/servers/${server.id}/test`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as
        | {
            error?: string;
            requiresTrust?: McpTrustSummary;
            tools?: DiscoveredTool[];
            warnings?: string[];
          }
        | null;
      if (res.status === 409 && data?.requiresTrust) {
        setPendingTrust({
          serverId: server.id,
          trust: data.requiresTrust,
          afterApprove: async () => test(server),
        });
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const tools = data?.tools ?? [];
      setToolsByServer((current) => ({ ...current, [server.id]: tools }));
      setTestOutput(
        `${server.displayName}: ${tools.length} tools${
          data?.warnings?.length ? ` | Warnings: ${data.warnings.length}` : ""
        }`,
      );
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "MCP test failed"));
    } finally {
      setTestingId(null);
    }
  };

  const approveTrust = async () => {
    if (!pendingTrust) return;
    const { serverId, trust, afterApprove } = pendingTrust;
    await requestJson<{ server: McpServerSummary }>("/api/mcp/trust", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        serverId,
        fingerprint: trust.fingerprint,
        approved: true,
      }),
    });
    setPendingTrust(null);
    await refresh();
    await afterApprove?.();
  };

  return (
    <SettingsPageShell
      title="MCP"
      description="Configure Model Context Protocol servers available to Anton."
      contentClassName="max-w-[960px] space-y-6"
    >
      {error && <ErrorBanner message={error} />}
      {testOutput && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          <span>{testOutput}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-success hover:bg-success/10 hover:text-success"
            aria-label="Dismiss MCP test result"
            onClick={() => setTestOutput(null)}
          >
            <X />
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold">Servers</h3>
          <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {servers.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void refresh()}
            disabled={loading}
            className="h-[33px] rounded-lg border-border px-3 text-[13px] font-medium"
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            type="button"
            onClick={() => {
              setDraft(EMPTY_DRAFT);
              setIsCreating(true);
            }}
            className="h-[33px] rounded-lg px-3 text-[13px] font-semibold"
          >
            <Plus className="size-3.5" />
            Add server
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-[10px] border border-border bg-card">
          {servers.length === 0 ? (
            <div className="p-5">
              <EmptyState message="No MCP servers configured." />
            </div>
          ) : (
            <ul className="divide-y divide-layout-border">
              {servers.map((server) => (
                <li key={server.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(serverToDraft(server));
                      setIsCreating(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3.5 py-3 text-left transition-colors",
                      selected?.id === server.id
                        ? "bg-secondary"
                        : "hover:bg-secondary/50",
                    )}
                  >
                    <span className="grid size-[30px] shrink-0 place-items-center rounded-[7px] border border-border bg-input">
                      <ServerIcon server={server} />
                    </span>
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="block truncate text-[13px] font-semibold">
                        {server.displayName}
                      </span>
                      <span className="block truncate font-mono text-[10.5px] text-muted-foreground/80">
                        {server.summary}
                      </span>
                    </span>
                    <ServerStatusBadge server={server} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {showEditor ? (
          <div className="overflow-hidden rounded-[10px] border border-border bg-card">
            <div className="flex items-center justify-between border-b border-layout-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Server className="size-3.5 text-muted-foreground" />
                <h3 className="text-sm font-semibold">
                  {draft.id ? "Edit server" : "New server"}
                </h3>
              </div>
              {selected && <ConnectionStatus server={selected} />}
            </div>

            <div className="space-y-3.5 p-4">
              <FormField label="Name">
                <input
                  value={draft.displayName}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, displayName: event.target.value }))
                  }
                  placeholder="Parallel Search MCP"
                  className={settingsInputClass}
                />
              </FormField>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Transport">
                  <Select
                    value={draft.transport}
                    onValueChange={(value) =>
                      setDraft((d) => ({
                        ...d,
                        transport: value as McpTransport,
                      }))
                    }
                  >
                    <SelectTrigger className={settingsSelectClass}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectViewport>
                        <SelectItem value="http">HTTP</SelectItem>
                        <SelectItem value="sse">SSE</SelectItem>
                        <SelectItem value="stdio">stdio</SelectItem>
                      </SelectViewport>
                    </SelectContent>
                  </Select>
                </FormField>

                {draft.transport === "stdio" ? (
                  <FormField label="Process cwd">
                    <input
                      value={draft.cwd}
                      onChange={(event) =>
                        setDraft((d) => ({ ...d, cwd: event.target.value }))
                      }
                      placeholder="optional working directory"
                      className={settingsInputClass}
                    />
                  </FormField>
                ) : (
                  <FormField label="Redirect">
                    <Select
                      value={draft.redirect}
                      onValueChange={(value) =>
                        setDraft((d) => ({
                          ...d,
                          redirect: value as "follow" | "error",
                        }))
                      }
                    >
                      <SelectTrigger className={settingsSelectClass}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectViewport>
                          <SelectItem value="error">Error</SelectItem>
                          <SelectItem value="follow">Follow</SelectItem>
                        </SelectViewport>
                      </SelectContent>
                    </Select>
                  </FormField>
                )}
              </div>

              {draft.transport === "stdio" ? (
                <>
                  <FormField label="Command">
                    <input
                      value={draft.command}
                      onChange={(event) =>
                        setDraft((d) => ({ ...d, command: event.target.value }))
                      }
                      placeholder="npx"
                      className={cn(settingsInputClass, "font-mono")}
                    />
                  </FormField>
                  <FormField label="Args">
                    <input
                      value={draft.args}
                      onChange={(event) =>
                        setDraft((d) => ({ ...d, args: event.target.value }))
                      }
                      placeholder="-y @modelcontextprotocol/server-filesystem <allowed-directory>"
                      className={cn(settingsInputClass, "font-mono")}
                    />
                  </FormField>
                  <FormField label="Env">
                    <textarea
                      value={draft.env}
                      onChange={(event) =>
                        setDraft((d) => ({ ...d, env: event.target.value }))
                      }
                      placeholder="API_KEY=value"
                      rows={3}
                      className={settingsTextareaClass}
                    />
                  </FormField>
                </>
              ) : (
                <>
                  <FormField label="URL">
                    <input
                      value={draft.url}
                      onChange={(event) =>
                        setDraft((d) => ({ ...d, url: event.target.value }))
                      }
                      placeholder="https://search.parallel.ai/mcp"
                      className={cn(settingsInputClass, "font-mono text-[12.5px]")}
                    />
                  </FormField>
                  <FormField label="Headers">
                    <textarea
                      value={draft.headers}
                      onChange={(event) =>
                        setDraft((d) => ({ ...d, headers: event.target.value }))
                      }
                      placeholder="Authorization=Bearer ..."
                      rows={3}
                      className={settingsTextareaClass}
                    />
                  </FormField>
                </>
              )}

              <div className="flex items-center justify-between pt-1">
                <div className="space-y-0.5">
                  <label
                    htmlFor="mcp-server-enabled"
                    className="text-[13px] font-medium"
                  >
                    Enabled
                  </label>
                  <p className="text-xs text-muted-foreground/80">
                    Server and its tools are available to the agent.
                  </p>
                </div>
                <Switch
                  id="mcp-server-enabled"
                  checked={draft.enabled}
                  onCheckedChange={(enabled) =>
                    setDraft((d) => ({ ...d, enabled }))
                  }
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-layout-border px-4 py-3">
              {draft.id ? (
                <button
                  type="button"
                  onClick={() => {
                    const server = servers.find((item) => item.id === draft.id);
                    if (server) void remove(server);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-[13px] font-medium text-destructive transition-colors hover:bg-destructive/15"
                >
                  <Trash2 className="size-3" />
                  Delete
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                {draft.id && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const server = servers.find((item) => item.id === draft.id);
                      if (server) void test(server);
                    }}
                    disabled={testingId === draft.id}
                    className="h-[33px] rounded-lg border-border px-3 text-[13px] font-medium"
                  >
                    {testingId === draft.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Activity className="size-3" />
                    )}
                    Test
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || draft.displayName.trim().length === 0}
                  className="h-[33px] rounded-lg px-4 text-[13px] font-semibold"
                >
                  {saving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  Save
                </Button>
              </div>
            </div>

            {draft.id && (
              <ToolChips
                tools={selectedTools}
                hasTested={draft.id in toolsByServer}
              />
            )}
          </div>
        ) : (
          <div className="flex min-h-[280px] items-center justify-center rounded-[10px] border border-border bg-card p-8">
            <p className="text-center text-[13px] text-muted-foreground">
              Select a server to edit, or add a new one.
            </p>
          </div>
        )}
      </div>

      <TrustDialog
        pending={pendingTrust}
        onClose={() => setPendingTrust(null)}
        onApprove={() => void approveTrust()}
      />
    </SettingsPageShell>
  );
}

const settingsInputClass =
  "h-[34px] w-full rounded-lg border border-border bg-input px-3 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring";

const settingsSelectClass =
  "h-[34px] w-full rounded-lg border-border bg-input text-[13px]";

const settingsTextareaClass =
  "min-h-16 w-full resize-y rounded-lg border border-border bg-input px-3 py-2.5 font-mono text-xs outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring";

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function ServerIcon({ server }: { server: McpServerSummary }) {
  const name = server.displayName.toLowerCase();
  const className = "size-3.5 text-muted-foreground";
  if (server.transport === "stdio") {
    return name.includes("filesystem") || name.includes("file") ? (
      <HardDrive className={className} />
    ) : (
      <TerminalSquare className={className} />
    );
  }
  if (name.includes("github")) {
    return <Network className={className} />;
  }
  return <Globe className={className} />;
}

function ServerStatusBadge({ server }: { server: McpServerSummary }) {
  if (server.trust.trusted) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
        <ShieldCheck className="size-2.5" />
        Trusted
      </span>
    );
  }
  if (server.enabled) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
        <span className="size-[5px] rounded-full bg-success" />
        On
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground/80">
      <span className="size-[5px] rounded-full bg-muted-foreground/50" />
      Off
    </span>
  );
}

function ConnectionStatus({ server }: { server: McpServerSummary }) {
  if (server.lastStatus === "ok") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/80">
        <span className="size-1.5 rounded-full bg-success" />
        Connected
      </span>
    );
  }
  if (server.lastStatus === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
        <span className="size-1.5 rounded-full bg-destructive" />
        Error
      </span>
    );
  }
  if (server.trust.trusted) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/80">
        <span className="size-1.5 rounded-full bg-success" />
        Trusted
      </span>
    );
  }
  return null;
}

function ToolChips({
  tools,
  hasTested,
}: {
  tools: DiscoveredTool[];
  hasTested: boolean;
}) {
  return (
    <section className="space-y-2.5 border-t border-layout-border px-4 py-3.5">
      <div className="flex items-center gap-2">
        <h4 className="text-[13px] font-semibold">Tools</h4>
        {hasTested && (
          <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {tools.length} discovered
          </span>
        )}
      </div>
      {!hasTested ? (
        <p className="text-xs text-muted-foreground">
          Test this server to discover its tools.
        </p>
      ) : tools.length === 0 ? (
        <p className="text-xs text-muted-foreground">No tools discovered.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tools.map((tool) => (
            <span
              key={tool.name}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-input px-2 py-1"
            >
              <Wrench className="size-2.5 text-muted-foreground/70" />
              <span className="font-mono text-[11.5px] text-muted-foreground">
                {tool.toolName ?? tool.name}
              </span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function TrustDialog({
  pending,
  onClose,
  onApprove,
}: {
  pending: PendingTrust | null;
  onClose: () => void;
  onApprove: () => void;
}) {
  return (
    <AlertDialog open={pending !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.trust.approval.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {pending?.trust.approval.summary}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {pending?.trust.approval.details.map((detail) => (
            <li key={detail} className="break-words">
              {detail}
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onApprove}>Trust server</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function serverToDraft(server: McpServerSummary): Draft {
  const config = server.config;
  if (config.type === "stdio") {
    return {
      id: server.id,
      displayName: server.displayName,
      transport: "stdio",
      enabled: server.enabled,
      url: "",
      command: config.command,
      args: config.args.join(" "),
      cwd: config.cwd ?? "",
      headers: "",
      env: recordToLines(config.env),
      redirect: "error",
    };
  }
  return {
    id: server.id,
    displayName: server.displayName,
    transport: config.type,
    enabled: server.enabled,
    url: config.url,
    command: "",
    args: "",
    cwd: "",
    headers: recordToLines(config.headers),
    env: "",
    redirect: config.redirect,
  };
}

function draftToRequest(draft: Draft): {
  displayName: string;
  transport: McpTransport;
  config: McpServerConfig;
  enabled: boolean;
} {
  return {
    displayName: draft.displayName.trim(),
    transport: draft.transport,
    enabled: draft.enabled,
    config:
      draft.transport === "stdio"
        ? ({
            type: "stdio",
            command: draft.command.trim(),
            args: splitArgs(draft.args),
            env: linesToRecord(draft.env),
            ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}),
          } satisfies StdioMcpConfig)
        : ({
            type: draft.transport,
            url: draft.url.trim(),
            headers: linesToRecord(draft.headers),
            redirect: draft.redirect,
          } satisfies RemoteMcpConfig),
  };
}

function splitArgs(value: string): string[] {
  return value.split(/\s+/).map((part) => part.trim()).filter(Boolean);
}

function linesToRecord(value: string): Record<string, string> {
  const record: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    record[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return record;
}

function recordToLines(record: Record<string, string>): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function removeKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}
