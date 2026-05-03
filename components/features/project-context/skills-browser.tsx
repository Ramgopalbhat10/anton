"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import type { SkillDocument, SkillSummary } from "@/src/lib/api-types";
import { errorMessage, getJson } from "@/src/lib/client-fetch";
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
} from "@/components/shared/feedback-states";

type SkillsBrowserVariant = "settings" | "compact";

export function useSkills(active: boolean) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [skillLoading, setSkillLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const loadSkills = async () => {
      setLoading(true);
      try {
        const data = await getJson<{
          skills: SkillSummary[];
          warnings: string[];
        }>("/api/skills");
        setSkills(data.skills);
        setWarnings(data.warnings);
        setSelectedSlug((current) =>
          current && data.skills.some((skill) => skill.slug === current)
            ? current
            : data.skills[0]?.slug ?? null,
        );
        setError(null);
      } catch (err) {
        setError(errorMessage(err, "Failed to load skills"));
      } finally {
        setLoading(false);
      }
    };
    void loadSkills();
  }, [active]);

  useEffect(() => {
    if (!selectedSlug) return;
    const loadSkill = async () => {
      setSkillLoading(true);
      try {
        const data = await getJson<{ skill: SkillDocument }>(
          `/api/skills/${encodeURIComponent(selectedSlug)}`,
        );
        setSelectedSkill(data.skill);
        setError(null);
      } catch (err) {
        setSelectedSkill(null);
        setError(errorMessage(err, "Failed to load skill"));
      } finally {
        setSkillLoading(false);
      }
    };
    void loadSkill();
  }, [selectedSlug]);

  return {
    skills,
    warnings,
    selectedSlug,
    selectedSkill,
    loading,
    skillLoading,
    error,
    setSelectedSlug,
  };
}

export function SkillsBrowser({
  active,
  variant = "compact",
}: {
  active: boolean;
  variant?: SkillsBrowserVariant;
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
    <div className={browserClassName(variant)}>
      <aside className={sidebarClassName(variant)}>
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
          <article className={variant === "settings" ? undefined : "space-y-3"}>
            <div className={variant === "settings" ? "mb-4" : undefined}>
              <h3 className="text-xs font-semibold">{selectedSkill.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedSkill.description || "No description."}
              </p>
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                {selectedSkill.path}
              </p>
            </div>
            <pre className={preClassName(variant)}>
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

function browserClassName(variant: SkillsBrowserVariant): string {
  if (variant === "settings") {
    return "grid min-h-[440px] overflow-hidden rounded-md bg-card ring-1 ring-border lg:grid-cols-[240px_minmax(0,1fr)]";
  }
  return "grid h-full min-h-0 grid-cols-1 md:grid-cols-[210px_1fr]";
}

function sidebarClassName(variant: SkillsBrowserVariant): string {
  if (variant === "settings") {
    return "min-h-0 border-b border-border bg-background/25 p-2 lg:border-b-0 lg:border-r";
  }
  return "min-h-0 overflow-y-auto border-b border-border bg-background/20 p-2 md:border-b-0 md:border-r";
}

function preClassName(variant: SkillsBrowserVariant): string {
  const maxHeight = variant === "settings" ? "max-h-[440px]" : "max-h-[420px]";
  return `${maxHeight} overflow-auto rounded-md bg-background/60 p-2.5 text-xs leading-normal whitespace-pre-wrap ring-1 ring-border`;
}
