"use client";

import type { ChatAddToolApproveResponseFunction } from "ai";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Disclosure } from "@/components/shared/disclosure";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ToolState } from "@/src/lib/trace";

import { DiffView, PatchDiffView } from "./diff-view";
import {
  isOkEditFileOutput,
  isOkEditTextOutput,
  isOkWriteFileOutput,
  pickString,
  safeStringify,
  toolStateBadge,
} from "./tool-display";

interface ToolCardProps {
  name: string;
  state: ToolState;
  input: unknown;
  output: unknown;
  errorText: string | undefined;
  approvalId: string | undefined;
  onApproval: ChatAddToolApproveResponseFunction;
}

export function ToolCard({
  name,
  state,
  input,
  output,
  errorText,
  approvalId,
  onApproval,
}: ToolCardProps) {
  const { label, tone } = toolStateBadge(state);

  return (
    <Disclosure
      className={cn(
        "rounded-md text-xs not-prose",
        "bg-card/50 text-foreground ring-1 ring-border",
      )}
      trigger={({ open }) => (
        <span className="flex min-w-0 items-center justify-between gap-2 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-[11px] font-semibold">
              {name}
            </span>
            {label.length > 0 && (
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                  tone,
                )}
              >
                {label}
              </span>
            )}
          </span>
          {open ? (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
          )}
        </span>
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="space-y-2 px-3 pb-3 pt-1">
          {name === "write_file" ? (
            <WriteFileBody input={input} output={output} state={state} />
          ) : name === "edit_file" ? (
            <EditFileBody input={input} output={output} state={state} />
          ) : name === "edit_text" ? (
            <EditTextBody input={input} output={output} state={state} />
          ) : (
            input !== undefined && (
              <Section title="input">
                <pre className="overflow-x-auto whitespace-pre-wrap wrap-break-word">
                  {safeStringify(input)}
                </pre>
              </Section>
            )
          )}

          {state === "approval-requested" && approvalId && (
            <div className="flex items-center gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                onClick={() => onApproval({ id: approvalId, approved: true })}
              >
                Approve
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => onApproval({ id: approvalId, approved: false })}
              >
                Deny
              </Button>
            </div>
          )}

          {state === "output-available" &&
            output !== undefined &&
            name !== "write_file" &&
            name !== "edit_text" && (
              <Section title="output">
                <pre className="overflow-x-auto whitespace-pre-wrap wrap-break-word">
                  {safeStringify(output)}
                </pre>
              </Section>
            )}

          {state === "output-error" && errorText && (
            <Section title="error" tone="error">
              <pre className="overflow-x-auto whitespace-pre-wrap wrap-break-word">
                {errorText}
              </pre>
            </Section>
          )}

          {state === "output-denied" && (
            <Section title="denied" tone="error">
              <span>Execution was denied by the user.</span>
            </Section>
          )}
        </div>
      </div>
    </Disclosure>
  );
}

function EditTextBody({
  input,
  output,
  state,
}: {
  input: unknown;
  output: unknown;
  state: ToolState;
}) {
  const relPath = pickString(input, "path");
  const showDiff = state === "output-available" && isOkEditTextOutput(output);

  if (showDiff) {
    return (
      <div className="space-y-2">
        <Section title="file">
          <span className="font-mono text-[11px]">
            {output.path ?? relPath ?? "?"}
          </span>
        </Section>
        <PatchDiffView
          patch={output.patchPreview ?? null}
          filename={output.path ?? relPath ?? "diff.txt"}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {relPath && (
        <Section title="file">
          <span className="font-mono text-[11px]">{relPath}</span>
        </Section>
      )}
      {state === "output-available" && output !== undefined ? (
        <Section title="output">
          <pre className="overflow-x-auto whitespace-pre-wrap wrap-break-word">
            {safeStringify(output)}
          </pre>
        </Section>
      ) : null}
    </div>
  );
}

function EditFileBody({
  input,
  output,
  state,
}: {
  input: unknown;
  output: unknown;
  state: ToolState;
}) {
  const relPath = pickString(input, "path");
  const showDiff =
    state === "output-available" &&
    isOkEditFileOutput(output) &&
    typeof output.previousContent === "string" &&
    typeof output.nextContent === "string";

  if (showDiff) {
    return (
      <div className="space-y-2">
        <Section title="file">
          <span className="font-mono text-[11px]">
            {output.path ?? relPath ?? "?"}
          </span>
        </Section>
        <DiffView
          previous={output.previousContent ?? ""}
          next={output.nextContent ?? ""}
          filename={output.path ?? relPath ?? undefined}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {relPath && (
        <Section title="file">
          <span className="font-mono text-[11px]">{relPath}</span>
        </Section>
      )}
      {pickString(input, "patch") !== undefined && (
        <Section title="patch">
          <pre className="overflow-x-auto whitespace-pre-wrap wrap-break-word">
            {pickString(input, "patch")}
          </pre>
        </Section>
      )}
    </div>
  );
}

function WriteFileBody({
  input,
  output,
  state,
}: {
  input: unknown;
  output: unknown;
  state: ToolState;
}) {
  const nextContent = pickString(input, "content");
  const relPath = pickString(input, "path");
  const showDiff =
    state === "output-available" &&
    isOkWriteFileOutput(output) &&
    nextContent !== undefined;

  if (showDiff) {
    return (
      <div className="space-y-2">
        <Section title="file">
          <span className="font-mono text-[11px]">
            {output.path ?? relPath ?? "?"}
          </span>
        </Section>
        {output.previousTruncated ? (
          <div className="rounded bg-background/60 px-3 py-2 text-[11px] text-muted-foreground ring-1 ring-border">
            Existing file was too large to diff inline ({output.bytesWritten}{" "}
            bytes written).
          </div>
        ) : (
          <DiffView
            previous={output.previousContent ?? ""}
            next={nextContent}
            newFile={output.existed === false}
            filename={output.path ?? relPath ?? undefined}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {relPath && (
        <Section title="file">
          <span className="font-mono text-[11px]">{relPath}</span>
        </Section>
      )}
      {nextContent !== undefined && (
        <Section title="new content">
          <pre className="overflow-x-auto whitespace-pre-wrap wrap-break-word">
            {nextContent}
          </pre>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "error";
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div
        className={cn(
          "text-[10px] uppercase tracking-wider",
          tone === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {title}
      </div>
      <div className="font-mono text-[11px] leading-snug">{children}</div>
    </div>
  );
}
