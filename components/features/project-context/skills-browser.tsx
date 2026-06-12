"use client";

import { AlertTriangle, ChevronRight, RefreshCw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
} from "@/components/shared/feedback-states";
import type { SkillDocument, SkillSummary } from "@/src/lib/api-types";

import { useSkills } from "./hooks";

export function SkillsBrowser({
  active,
}: {
  active: boolean;
}) {
  const {
    skills,
    warnings,
    selectedSlug,
    selectedSkill,
    loading,
    skillLoading,
    error,
    setSelectedSlug,
    refresh,
  } = useSkills(active);

  return (
    <>
      {error && <ErrorBanner message={error} />}
      {warnings.length > 0 && <SkillWarnings warnings={warnings} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold">Workspace skills</h3>
          <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {skills.length}
          </span>
        </div>
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
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-[10px] border border-border bg-card">
          {loading ? (
            <div className="p-5">
              <LoadingState label="Loading skills" />
            </div>
          ) : skills.length === 0 ? (
            <div className="p-5">
              <EmptyState message="No workspace skills found." />
            </div>
          ) : (
            <ul className="divide-y divide-layout-border">
              {skills.map((skill) => (
                <SkillListItem
                  key={skill.slug}
                  skill={skill}
                  selected={selectedSlug === skill.slug}
                  onSelect={() => setSelectedSlug(skill.slug)}
                />
              ))}
            </ul>
          )}
        </div>

        {!selectedSlug ? (
          <div className="flex min-h-[280px] items-center justify-center rounded-[10px] border border-border bg-card p-8">
            <p className="text-center text-[13px] text-muted-foreground">
              Select a skill to inspect it.
            </p>
          </div>
        ) : skillLoading ? (
          <div className="flex min-h-[280px] items-center justify-center rounded-[10px] border border-border bg-card p-8">
            <LoadingState label="Loading skill" />
          </div>
        ) : selectedSkill ? (
          <SkillDetailCard skill={selectedSkill} />
        ) : null}
      </div>
    </>
  );
}

function SkillListItem({
  skill,
  selected,
  onSelect,
}: {
  skill: SkillSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-2.5 px-3.5 py-3 text-left transition-colors",
          selected ? "bg-secondary" : "hover:bg-secondary/50",
        )}
      >
        <span className="grid size-[30px] shrink-0 place-items-center rounded-[7px] border border-border bg-input">
          <Sparkles
            className={cn(
              "size-3.5",
              selected ? "text-primary" : "text-muted-foreground",
            )}
          />
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block truncate font-mono text-[12.5px] font-semibold">
            {skill.name}
          </span>
          <span className="block truncate text-[11.5px] text-muted-foreground/80">
            {skill.description || "No description."}
          </span>
        </span>
        {selected && (
          <ChevronRight className="size-[13px] shrink-0 text-muted-foreground/70" />
        )}
      </button>
    </li>
  );
}

function SkillDetailCard({ skill }: { skill: SkillDocument }) {
  return (
    <article className="overflow-hidden rounded-[10px] border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-layout-border px-4 py-3">
        <h3 className="truncate font-mono text-[13.5px] font-semibold">
          {skill.name}
        </h3>
      </div>

      <div className="space-y-3.5 p-4">
        <p className="text-[13px] leading-[1.55] text-muted-foreground">
          {skill.description || "No description."}
        </p>

        <dl className="space-y-2">
          <SkillMetaRow label="Path">
            <span className="font-mono">{skill.path}</span>
          </SkillMetaRow>
          <SkillMetaRow label="Source">Workspace</SkillMetaRow>
          <SkillMetaRow label="Updated">
            {formatUpdatedAt(skill.updatedAt)}
          </SkillMetaRow>
        </dl>

        <div className="border-t border-layout-border" />

        <p className="text-xs font-medium text-muted-foreground">
          SKILL.md preview
        </p>
        <pre className="max-h-[440px] overflow-auto rounded-lg border border-border bg-background px-3.5 py-3 font-mono text-[11.5px] leading-[1.7] whitespace-pre-wrap text-muted-foreground">
          {skill.body || "(empty)"}
        </pre>
      </div>
    </article>
  );
}

function SkillMetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3 text-[12.5px]">
      <dt className="w-20 shrink-0 text-muted-foreground/70">{label}</dt>
      <dd className="min-w-0 break-all text-muted-foreground">{children}</dd>
    </div>
  );
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function SkillWarnings({ warnings }: { warnings: string[] }) {
  return (
    <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-3.5" />
        Skill warnings
      </div>
      <ul className="list-disc space-y-1 pl-5">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}
