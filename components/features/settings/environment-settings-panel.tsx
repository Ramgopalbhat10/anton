"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FolderGit2,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
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
  AlertDialogTrigger,
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
import { Textarea } from "@/components/ui/textarea";
import type {
  ProjectEnvironmentSummary,
  ProjectSummary,
} from "@/src/lib/api-types";
import {
  errorMessage,
  getJson,
  jsonHeaders,
  requestJson,
} from "@/src/lib/client-fetch";

import { SettingsPageShell } from "./settings-shell";

type EnvironmentPatch = {
  enabled?: boolean;
  upsert?: { key: string; value: string }[];
  delete?: string[];
};

type FormMode = "create" | "edit";

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export function EnvironmentSettingsPanel() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [environment, setEnvironment] =
    useState<ProjectEnvironmentSummary | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingEnvironment, setLoadingEnvironment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const readyProjects = useMemo(
    () => projects.filter((project) => project.status === "ready"),
    [projects],
  );
  const selectedProject = readyProjects.find(
    (project) => project.id === selectedProjectId,
  );
  const filteredVariables = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const variables = environment?.variables ?? [];
    if (!normalized) return variables;
    return variables.filter((variable) =>
      variable.key.toLowerCase().includes(normalized),
    );
  }, [environment?.variables, query]);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const data = await getJson<{ projects: ProjectSummary[] }>("/api/projects");
      const ready = data.projects.filter((project) => project.status === "ready");
      setProjects(data.projects);
      setSelectedProjectId((current) =>
        current && ready.some((project) => project.id === current)
          ? current
          : ready[0]?.id ?? "",
      );
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Failed to load projects"));
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const loadEnvironment = useCallback(async (projectId: string) => {
    if (!projectId) {
      setEnvironment(null);
      return;
    }
    setLoadingEnvironment(true);
    try {
      const data = await getJson<{ environment: ProjectEnvironmentSummary }>(
        `/api/projects/${projectId}/environment`,
      );
      setEnvironment(data.environment);
      setError(null);
    } catch (err) {
      setEnvironment(null);
      setError(errorMessage(err, "Failed to load environment"));
    } finally {
      setLoadingEnvironment(false);
    }
  }, []);

  useEffect(() => {
    // Initial settings hydration updates state after the project request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    // Loading follows the selected project and writes the fetched summary into state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEnvironment(selectedProjectId);
  }, [loadEnvironment, selectedProjectId]);

  const patchEnvironment = async (patch: EnvironmentPatch) => {
    if (!selectedProjectId) return;
    setSaving(true);
    try {
      const data = await requestJson<{ environment: ProjectEnvironmentSummary }>(
        `/api/projects/${selectedProjectId}/environment`,
        {
          method: "PATCH",
          headers: jsonHeaders(),
          body: JSON.stringify(patch),
        },
      );
      setEnvironment(data.environment);
      setProjects((current) =>
        current.map((project) =>
          project.id === data.environment.projectId
            ? { ...project, environmentEnabled: data.environment.enabled }
            : project,
        ),
      );
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Failed to save environment"));
    } finally {
      setSaving(false);
    }
  };

  const startCreate = () => {
    setFormMode("create");
    setDraftKey("");
    setDraftValue("");
  };

  const startEdit = (key: string) => {
    setFormMode("edit");
    setDraftKey(key);
    setDraftValue("");
  };

  const cancelForm = () => {
    setFormMode(null);
    setDraftKey("");
    setDraftValue("");
  };

  const submitForm = async () => {
    const key = draftKey.trim();
    if (!ENV_KEY_PATTERN.test(key) || draftValue.length === 0) return;
    await patchEnvironment({ upsert: [{ key, value: draftValue }] });
    cancelForm();
  };

  const submitImport = async () => {
    const parsed = parseImportText(importText);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    if (parsed.upsert.length === 0) return;
    await patchEnvironment({ upsert: parsed.upsert });
    setImportText("");
    setImportOpen(false);
  };

  const disabled = saving || loadingEnvironment || !selectedProject;
  const formKeyValid = ENV_KEY_PATTERN.test(draftKey.trim());
  const formValueValid = draftValue.length > 0;
  const canSubmitForm = formKeyValid && formValueValid && !disabled;

  return (
    <SettingsPageShell
      title="Environment"
      description="Store per-project environment variables in the selected repository .env file and inject them into Anton project commands."
      contentClassName="max-w-[1040px] space-y-6"
    >
      {error && <ErrorBanner message={error} />}

      <section className="rounded-[10px] border border-border bg-card">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <KeyRound className="size-3.5 text-muted-foreground" />
                Project environment
              </h3>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                App runtime secrets stay in deployment settings. These variables
                are only for commands run inside the selected project.
              </p>
            </div>
            {selectedProject && environment && (
              <label className="flex shrink-0 items-center gap-3 rounded-lg border border-border bg-input px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Include in environment
                </span>
                <Switch
                  checked={environment.enabled}
                  onCheckedChange={(checked) =>
                    void patchEnvironment({ enabled: checked })
                  }
                  disabled={saving || loadingEnvironment}
                  aria-label="Include project environment"
                />
              </label>
            )}
          </div>

          {readyProjects.length === 0 ? (
            <EmptyState
              message={
                loadingProjects
                  ? "Loading projects..."
                  : "Import or clone a project before adding environment variables."
              }
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Project
                </label>
                <Select
                  value={selectedProjectId}
                  onValueChange={setSelectedProjectId}
                  disabled={loadingProjects || saving}
                >
                  <SelectTrigger className="h-[34px] w-full rounded-lg border-border bg-input text-[13px]">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectViewport>
                      {readyProjects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.fullName}
                        </SelectItem>
                      ))}
                    </SelectViewport>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Env file
                </span>
                <div className="flex h-[34px] min-w-0 items-center gap-2 rounded-lg border border-border bg-input px-3">
                  <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground/70" />
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {environment?.envFile ?? selectedProject?.localPath ?? "-"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {selectedProject && (
        <section className="overflow-hidden rounded-[10px] border border-border bg-card">
          <div className="flex flex-col gap-3 border-b border-layout-border px-4 py-3 md:flex-row md:items-center md:justify-between">
            <label className="flex h-[33px] min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-input px-3 transition-colors focus-within:border-ring md:max-w-md">
              <Search className="size-3.5 shrink-0 text-muted-foreground/70" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search variables..."
                aria-label="Search environment variables"
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70"
              />
            </label>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="h-[33px] rounded-lg border-border px-3 text-[13px]"
                onClick={() => setImportOpen((open) => !open)}
                disabled={disabled}
              >
                <Upload className="size-3.5" />
                Import
              </Button>
              <Button
                type="button"
                className="h-[33px] rounded-lg px-3 text-[13px]"
                onClick={startCreate}
                disabled={disabled}
              >
                <Plus className="size-3.5" />
                Create
              </Button>
            </div>
          </div>

          {importOpen && (
            <div className="space-y-3 border-b border-layout-border px-4 py-4">
              <Textarea
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder={"GITHUB_TOKEN=...\nGH_TOKEN=..."}
                className="min-h-28 rounded-lg border-border bg-input font-mono text-xs"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setImportOpen(false);
                    setImportText("");
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void submitImport()}
                  disabled={saving || importText.trim().length === 0}
                >
                  {saving && <Loader2 className="animate-spin" />}
                  Import secrets
                </Button>
              </div>
            </div>
          )}

          {formMode && (
            <div className="grid gap-3 border-b border-layout-border px-4 py-4 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Name
                </label>
                <input
                  value={draftKey}
                  onChange={(event) => setDraftKey(event.target.value)}
                  readOnly={formMode === "edit"}
                  placeholder="GITHUB_TOKEN"
                  className="h-[34px] w-full rounded-lg border border-border bg-input px-3 font-mono text-[13px] outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring read-only:text-muted-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {formMode === "edit" ? "Replacement value" : "Value"}
                </label>
                <input
                  value={draftValue}
                  onChange={(event) => setDraftValue(event.target.value)}
                  type="password"
                  placeholder="Enter secret value"
                  className="h-[34px] w-full rounded-lg border border-border bg-input px-3 font-mono text-[13px] outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={cancelForm}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void submitForm()}
                  disabled={!canSubmitForm}
                >
                  {saving && <Loader2 className="animate-spin" />}
                  {formMode === "edit" ? "Update" : "Create"}
                </Button>
              </div>
            </div>
          )}

          {loadingEnvironment ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading environment
            </div>
          ) : filteredVariables.length === 0 ? (
            <div className="p-5">
              <EmptyState
                message={
                  environment?.variables.length
                    ? "No variables match."
                    : "No environment variables yet."
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead className="bg-muted/45 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Value</th>
                    <th className="px-4 py-3 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-layout-border">
                  {filteredVariables.map((variable) => (
                    <tr key={variable.key} className="hover:bg-muted/25">
                      <td className="px-4 py-3 font-mono text-[13px] font-medium">
                        {variable.key}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-muted-foreground">
                        Raw secret
                      </td>
                      <td className="px-4 py-3 text-[13px] text-muted-foreground">
                        Hidden
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => startEdit(variable.key)}
                            disabled={disabled}
                            aria-label={`Edit ${variable.key}`}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={disabled}
                                aria-label={`Delete ${variable.key}`}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Delete environment variable?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  This removes {variable.key} from the project
                                  .env file. Existing command output is not
                                  changed.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={saving}>
                                  Cancel
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  variant="destructive"
                                  disabled={saving}
                                  onClick={() =>
                                    void patchEnvironment({
                                      delete: [variable.key],
                                    })
                                  }
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </SettingsPageShell>
  );
}

function parseImportText(
  text: string,
): { upsert: { key: string; value: string }[] } | { error: string } {
  const upsert: { key: string; value: string }[] = [];
  const seen = new Set<string>();
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match =
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) {
      return { error: `Line ${index + 1} is not a KEY=value assignment.` };
    }
    const key = match[1] ?? "";
    if (!ENV_KEY_PATTERN.test(key)) {
      return { error: `Line ${index + 1} has an invalid variable name.` };
    }
    if (seen.has(key)) continue;
    seen.add(key);
    upsert.push({ key, value: parseImportedValue(match[2] ?? "") });
  }
  return { upsert };
}

function parseImportedValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\");
  }
  return raw.replace(/\s+#.*$/, "").trim();
}
