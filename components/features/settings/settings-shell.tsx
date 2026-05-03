"use client";

import type { ReactNode } from "react";
import { ChevronLeft, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SettingsSection = "workspaces" | "memories" | "skills";

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
        <aside className="hidden min-h-0 border-r border-border bg-sidebar md:flex md:flex-col">
          <div className="border-b border-border px-3 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 mb-3 h-6 text-xs text-muted-foreground"
              onClick={onClose}
            >
              <ChevronLeft />
              Back
            </Button>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                className="h-8 w-full rounded-md bg-secondary pl-8 pr-2.5 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                placeholder="Search settings..."
              />
            </label>
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
            <SettingsGroup title="Project context">
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
          <header className="flex h-10 items-center justify-between border-b border-border px-3 md:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <span className="hidden text-xs text-muted-foreground md:inline">
                Settings
              </span>
              <span className="hidden text-muted-foreground md:inline">/</span>
              <h1 id="settings-title" className="truncate text-xs font-semibold">
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

          <div className="flex gap-1.5 overflow-x-auto border-b border-border px-2 py-1.5 md:hidden">
            <MobileTab
              active={section === "workspaces"}
              onClick={() => onSectionChange("workspaces")}
            >
              Workspaces
            </MobileTab>
            <MobileTab
              active={section === "memories"}
              onClick={() => onSectionChange("memories")}
            >
              Memories
            </MobileTab>
            <MobileTab
              active={section === "skills"}
              onClick={() => onSectionChange("skills")}
            >
              Skills
            </MobileTab>
          </div>

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
      <div className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
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
    <section className="rounded-md bg-card p-3 ring-1 ring-border">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold [&_svg]:size-4">
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
    <section className="mb-4">
      <h2 className="mb-1.5 px-2 text-[11px] font-medium text-muted-foreground">
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
        "flex h-7 w-full items-center rounded-md px-2 text-left text-xs font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-foreground hover:bg-sidebar-accent/70",
      )}
    >
      {children}
    </button>
  );
}

function MobileTab({
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
        "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium",
        active ? "bg-secondary text-foreground" : "text-muted-foreground",
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
    case "memories":
      return "Memories";
    case "skills":
      return "Skills";
  }
}
