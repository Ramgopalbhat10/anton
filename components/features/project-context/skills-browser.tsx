"use client";

import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
} from "@/components/shared/feedback-states";

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
  } = useSkills(active);

  return (
    <div className="grid min-h-[440px] overflow-hidden rounded-md bg-card ring-1 ring-border lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="min-h-0 border-b border-border bg-background/25 p-2 lg:border-b-0 lg:border-r">
        {loading ? (
          <LoadingState label="Loading skills" />
        ) : skills.length === 0 ? (
          <EmptyState message="No workspace skills found." />
        ) : (
          <ul className="space-y-1">
            {skills.map((skill) => (
              <li key={skill.slug}>
                <button
                  type="button"
                  onClick={() => setSelectedSlug(skill.slug)}
                  className={cn(
                    "w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    selectedSlug === skill.slug
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
                  )}
                >
                  <span className="block truncate font-medium">
                    {skill.name}
                  </span>
                  <span className="block truncate font-mono text-[10px]">
                    {skill.slug}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="min-h-0 overflow-y-auto p-3">
        {error && <ErrorBanner message={error} />}
        {warnings.length > 0 && <SkillWarnings warnings={warnings} />}
        {!selectedSlug ? (
          <EmptyState message="Select a skill to inspect it." />
        ) : skillLoading ? (
          <LoadingState label="Loading skill" />
        ) : selectedSkill ? (
          <article>
            <div className="mb-4">
              <h3 className="text-xs font-semibold">{selectedSkill.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedSkill.description || "No description."}
              </p>
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                {selectedSkill.path}
              </p>
            </div>
            <pre className="max-h-[440px] overflow-auto rounded-md bg-background/60 p-2.5 text-xs leading-normal whitespace-pre-wrap ring-1 ring-border">
              {selectedSkill.body || "(empty)"}
            </pre>
          </article>
        ) : null}
      </section>
    </div>
  );
}
function SkillWarnings({ warnings }: { warnings: string[] }) {
  return (
    <div className="mb-2.5 space-y-1 rounded-md bg-amber-500/10 p-2.5 text-xs text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-300">
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
