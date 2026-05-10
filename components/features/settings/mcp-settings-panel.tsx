"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Server,
  TerminalSquare,
  Trash2,
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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

import { SettingsCard, SettingsPageShell } from "./settings-shell";

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
  const [pendingTrust, setPendingTrust] = useState<PendingTrust | null>(null);

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

  const selected = useMemo(
    () => servers.find((server) => server.id === draft.id) ?? null,
    [draft.id, servers],
  );

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
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to save MCP server"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (server: McpServerSummary) => {
    await requestOk(`/api/mcp/servers/${server.id}`, { method: "DELETE" });
    if (draft.id === server.id) setDraft(EMPTY_DRAFT);
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
            tools?: { name: string }[];
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
      setTestOutput(
        `Tools: ${data?.tools?.length ?? 0}${
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
    >
      {error && <ErrorBanner message={error} />}
      {testOutput && (
        <div className="rounded-md bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-300 ring-1 ring-emerald-500/25">
          {testOutput}
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <SettingsCard
          title="Servers"
          icon={<Server />}
          action={
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void refresh()}
                disabled={loading}
              >
                <RefreshCw className={cn(loading && "animate-spin")} />
                Refresh
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setDraft(EMPTY_DRAFT)}
              >
                <Plus />
                Add
              </Button>
            </div>
          }
        >
          {servers.length === 0 ? (
            <EmptyState message="No MCP servers configured." />
          ) : (
            <ul className="grid gap-2">
              {servers.map((server) => (
                <li key={server.id}>
                  <button
                    type="button"
                    onClick={() => setDraft(serverToDraft(server))}
                    className={cn(
                      "grid w-full grid-cols-[1fr_auto] gap-3 rounded-md p-2.5 text-left ring-1 transition-colors",
                      selected?.id === server.id
                        ? "bg-primary/10 ring-primary/50"
                        : "bg-background/45 ring-border hover:bg-accent",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-xs font-medium">
                        {server.transport === "stdio" ? (
                          <TerminalSquare className="size-3.5" />
                        ) : (
                          <Network className="size-3.5" />
                        )}
                        <span className="truncate">{server.displayName}</span>
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                        {server.summary}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-[10px] uppercase text-muted-foreground">
                      {server.enabled ? "enabled" : "off"}
                      {" / "}
                      {server.trust.trusted ? "trusted" : "untrusted"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>

        <SettingsCard title={draft.id ? "Edit server" : "New server"} icon={<Server />}>
          <div className="grid gap-2">
            <LabeledInput
              label="Name"
              value={draft.displayName}
              onChange={(displayName) => setDraft((d) => ({ ...d, displayName }))}
              placeholder="Parallel Search MCP"
            />
            <div className="grid gap-1">
              <label className="text-[11px] font-medium text-muted-foreground">
                Transport
              </label>
              <Select
                value={draft.transport}
                onValueChange={(value) =>
                  setDraft((d) => ({ ...d, transport: value as McpTransport }))
                }
              >
                <SelectTrigger className="h-8">
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
            </div>

            {draft.transport === "stdio" ? (
              <>
                <LabeledInput
                  label="Command"
                  value={draft.command}
                  onChange={(command) => setDraft((d) => ({ ...d, command }))}
                  placeholder="npx"
                />
                <LabeledInput
                  label="Args"
                  value={draft.args}
                  onChange={(args) => setDraft((d) => ({ ...d, args }))}
                  placeholder="-y @modelcontextprotocol/server-filesystem <allowed-directory>"
                  hint="Arguments passed to the command. Filesystem MCP allowed directories go here."
                />
                <LabeledInput
                  label="Process cwd"
                  value={draft.cwd}
                  onChange={(cwd) => setDraft((d) => ({ ...d, cwd }))}
                  placeholder="optional process working directory"
                  hint="This only changes where the process starts; it does not configure filesystem access."
                />
                <LabeledTextarea
                  label="Env"
                  value={draft.env}
                  onChange={(env) => setDraft((d) => ({ ...d, env }))}
                  placeholder="API_KEY=value"
                />
              </>
            ) : (
              <>
                <LabeledInput
                  label="URL"
                  value={draft.url}
                  onChange={(url) => setDraft((d) => ({ ...d, url }))}
                  placeholder="https://search.parallel.ai/mcp"
                />
                <LabeledTextarea
                  label="Headers"
                  value={draft.headers}
                  onChange={(headers) => setDraft((d) => ({ ...d, headers }))}
                  placeholder="Authorization=Bearer ..."
                />
                <div className="grid gap-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    Redirect
                  </label>
                  <Select
                    value={draft.redirect}
                    onValueChange={(value) =>
                      setDraft((d) => ({
                        ...d,
                        redirect: value as "follow" | "error",
                      }))
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectViewport>
                        <SelectItem value="error">Error</SelectItem>
                        <SelectItem value="follow">Follow</SelectItem>
                      </SelectViewport>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <button
              type="button"
              className={cn(
                "flex h-7 items-center justify-between rounded-md px-2 text-xs ring-1 ring-border",
                draft.enabled ? "bg-primary/10 text-primary" : "bg-background/45",
              )}
              onClick={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))}
            >
              Enabled
              <span>{draft.enabled ? "on" : "off"}</span>
            </button>

            <div className="flex items-center justify-between gap-2 pt-1">
              {draft.id ? (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    const server = servers.find((item) => item.id === draft.id);
                    if (server) void remove(server);
                  }}
                >
                  <Trash2 />
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-1.5">
                {draft.id && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const server = servers.find((item) => item.id === draft.id);
                      if (server) void test(server);
                    }}
                    disabled={testingId === draft.id}
                  >
                    {testingId === draft.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <RefreshCw />
                    )}
                    Test
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void save()}
                  disabled={saving || draft.displayName.trim().length === 0}
                >
                  {saving ? <Loader2 className="animate-spin" /> : <Check />}
                  Save
                </Button>
              </div>
            </div>
          </div>
        </SettingsCard>
      </div>

      <TrustDialog
        pending={pendingTrust}
        onClose={() => setPendingTrust(null)}
        onApprove={() => void approveTrust()}
      />
    </SettingsPageShell>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="grid gap-1">
      <label className="text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-8 font-mono"
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="grid gap-1">
      <label className="text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-16 font-mono text-xs"
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
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
