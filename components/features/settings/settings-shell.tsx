"use client";

import type { ReactNode } from "react";
import {
  ArrowLeft,
  Brain,
  FolderGit2,
  Plug,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/shared/search-field";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type SettingsSection = "workspaces" | "agent" | "mcp" | "memories" | "skills";

export function SettingsShell({
  section,
  onSectionChange,
  onClose,
  children,
}: {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-background"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div className="grid h-dvh min-h-0 grid-cols-1 md:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 border-r border-sidebar-border bg-sidebar px-3 py-4 md:flex md:flex-col">
          <button
            type="button"
            onClick={onClose}
            className="mb-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </button>
          <SearchField
            placeholder="Search settings..."
            aria-label="Search settings"
            className="rounded-lg bg-input px-2.5 py-2"
            inputClassName="text-[13px]"
          />

          <nav className="mt-1 min-h-0 flex-1 overflow-y-auto">
            <SettingsGroup title="Workspace">
              <SettingsNavButton
                active={section === "workspaces"}
                onClick={() => onSectionChange("workspaces")}
                icon={<FolderGit2 />}
              >
                Workspaces
              </SettingsNavButton>
              <SettingsNavButton
                active={section === "agent"}
                onClick={() => onSectionChange("agent")}
                icon={<SlidersHorizontal />}
              >
                Agent defaults
              </SettingsNavButton>
            </SettingsGroup>
            <SettingsGroup title="Project context">
              <SettingsNavButton
                active={section === "mcp"}
                onClick={() => onSectionChange("mcp")}
                icon={<Plug />}
              >
                MCP
              </SettingsNavButton>
              <SettingsNavButton
                active={section === "memories"}
                onClick={() => onSectionChange("memories")}
                icon={<Brain />}
              >
                Memories
              </SettingsNavButton>
              <SettingsNavButton
                active={section === "skills"}
                onClick={() => onSectionChange("skills")}
                icon={<Sparkles />}
              >
                Skills
              </SettingsNavButton>
            </SettingsGroup>
          </nav>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col bg-background">
          <header className="flex items-center justify-between border-b border-layout-border px-4 py-3 md:px-6">
            <div className="flex min-w-0 items-center gap-2 text-[13px]">
              <span className="hidden text-muted-foreground/80 md:inline">
                Settings
              </span>
              <span className="hidden text-muted-foreground/80 md:inline">/</span>
              <h1 id="settings-title" className="truncate font-medium">
                {sectionTitle(section)}
              </h1>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close settings"
            >
              <X className="text-muted-foreground" />
            </Button>
          </header>

          <Tabs
            value={section}
            onValueChange={(value) =>
              onSectionChange(value as SettingsSection)
            }
            className="overflow-x-auto border-b border-layout-border px-2 py-1 md:hidden"
          >
            <TabsList size="sm">
              <TabsTrigger value="workspaces">Workspaces</TabsTrigger>
              <TabsTrigger value="agent">Agent</TabsTrigger>
              <TabsTrigger value="mcp">MCP</TabsTrigger>
              <TabsTrigger value="memories">Memories</TabsTrigger>
              <TabsTrigger value="skills">Skills</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8 md:px-10 md:py-10">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function SettingsPageShell({
  title,
  description,
  children,
  contentClassName,
}: {
  title: string;
  description: string;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[760px] space-y-8 pb-6",
        contentClassName,
      )}
    >
      <div className="space-y-1.5">
        <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

export function SettingsCard({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
          {icon}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="px-2 pb-1.5 pt-4 text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground/70">
        {title}
      </h2>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function SettingsNavButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-[7px] text-left text-[13px] transition-colors duration-150 [&_svg]:size-3.5 [&_svg]:shrink-0",
        active
          ? "bg-sidebar-accent font-medium text-foreground [&_svg]:text-primary"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground [&_svg]:text-muted-foreground/70",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function sectionTitle(section: SettingsSection): string {
  switch (section) {
    case "workspaces":
      return "Workspaces";
    case "agent":
      return "Agent defaults";
    case "mcp":
      return "MCP";
    case "memories":
      return "Memories";
    case "skills":
      return "Skills";
  }
}
