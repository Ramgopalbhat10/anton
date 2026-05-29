"use client";

import type { ReactNode } from "react";
import { ChevronLeft, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/shared/search-field";
import { Surface } from "@/components/shared/surface";
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
      <div className="grid h-dvh min-h-0 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 border-r border-layout-border bg-sidebar md:flex md:flex-col">
          <div className="border-b border-layout-border px-3 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 mb-2 h-6 text-xs text-muted-foreground"
              onClick={onClose}
            >
              <ChevronLeft />
              Back
            </Button>
            <SearchField
              placeholder="Search settings..."
              aria-label="Search settings"
            />
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto p-2">
            <SettingsGroup title="Workspace">
              <SettingsNavButton
                active={section === "workspaces"}
                onClick={() => onSectionChange("workspaces")}
              >
                Workspaces
              </SettingsNavButton>
            </SettingsGroup>
            <SettingsGroup title="Agent">
              <SettingsNavButton
                active={section === "agent"}
                onClick={() => onSectionChange("agent")}
              >
                Agent defaults
              </SettingsNavButton>
            </SettingsGroup>
            <SettingsGroup title="Project context">
              <SettingsNavButton
                active={section === "mcp"}
                onClick={() => onSectionChange("mcp")}
              >
                MCP
              </SettingsNavButton>
              <SettingsNavButton
                active={section === "memories"}
                onClick={() => onSectionChange("memories")}
              >
                Memories
              </SettingsNavButton>
              <SettingsNavButton
                active={section === "skills"}
                onClick={() => onSectionChange("skills")}
              >
                Skills
              </SettingsNavButton>
            </SettingsGroup>
          </nav>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col bg-background">
          <header className="flex h-10 items-center justify-between border-b border-layout-border px-3 md:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <span className="hidden text-xs text-muted-foreground md:inline">
                Settings
              </span>
              <span className="hidden text-muted-foreground md:inline">/</span>
              <h1 id="settings-title" className="truncate text-xs font-semibold tracking-tight">
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
              <X />
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

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 md:px-8">
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
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-3">
      <div className="mb-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
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
    <Surface variant="elevated" padding="md">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold [&_svg]:size-3.5">
          {icon}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </Surface>
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
    <section className="mb-3">
      <h2 className="mb-1 px-2 text-[11px] font-medium text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function SettingsNavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-7 w-full items-center rounded-md px-2 text-left text-xs font-medium transition-colors duration-150",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
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
