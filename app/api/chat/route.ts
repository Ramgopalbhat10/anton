import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type FinishReason,
  type LanguageModelUsage,
  type TextStreamPart,
  type ToolSet,
  type UIMessageStreamWriter,
} from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { runAgent } from "@/src/agent/loop";
import type { PermissionMode } from "@/src/agent/permissions";
import {
  addSessionTokens,
  createRun,
  createSession,
  deriveTitleFromMessages,
  getProject,
  getSession,
  replaceMessages,
  setSessionProject,
  touchSession,
  updateRun,
  upsertRunEvent,
} from "@/src/db/queries";
import { DEFAULT_MODEL } from "@/src/lib/providers";
import type {
  AntonActivityEvent,
  AntonActivityKind,
  AntonActivityStatus,
  AntonMessageMetadata,
  AntonRunData,
  AntonRunStatus,
  AntonUIMessage,
} from "@/src/lib/trace";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  model: z.string().min(1).optional(),
  permissionMode: z.enum(["default", "auto-review", "full-access"]).optional(),
  messages: z.array(z.unknown()).min(1),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { sessionId } = parsed.data;
  const uiMessages = parsed.data.messages as AntonUIMessage[];
  const model = parsed.data.model ?? DEFAULT_MODEL;

  const existing = getSession(sessionId);
  const projectId = existing?.projectId ?? parsed.data.projectId ?? null;
  if (!projectId) {
    return Response.json(
      { error: "projectId is required for agent chat sessions" },
      { status: 400 },
    );
  }

  const project = getProject(projectId);
  if (!project || project.status !== "ready") {
    return Response.json(
      { error: "project not found or not ready" },
      { status: 400 },
    );
  }

  if (!existing) {
    createSession({
      id: sessionId,
      title: deriveTitleFromMessages(uiMessages),
      model,
      projectId,
    });
  } else {
    if (!existing.projectId && projectId) {
      setSessionProject(sessionId, projectId);
    }
    if (existing.model !== model) {
      touchSession(sessionId, model);
    }
  }

  const modelMessages = await convertToModelMessages(
    prepareMessagesForModel(uiMessages),
    {
      convertDataPart: () => undefined,
    },
  );

  const runId = randomUUID();
  const startedAt = Date.now();
  createRun({
    id: runId,
    sessionId,
    model,
    status: "running",
    startedAt: new Date(startedAt),
  });

  const stream = createUIMessageStream<AntonUIMessage>({
    originalMessages: uiMessages,
    execute: async ({ writer }) => {
      const trace = createTraceWriter({
        writer,
        runId,
        model,
        startedAt,
      });
      trace.writeRun("running");

      try {
        const result = await runAgent({
          messages: modelMessages,
          model,
          workspaceRoot: project.localPath,
          permissionMode: parsed.data.permissionMode as
            | PermissionMode
            | undefined,
          onStepStart: ({ stepNumber }) => trace.startStep(stepNumber),
          onStepFinish: ({ stepNumber }) => trace.finishStep(stepNumber),
          onToolCallStart: (event) => trace.startTool(event),
          onToolCallFinish: (event) => trace.finishTool(event),
          onStreamPart: (part) => trace.handleStreamPart(part),
          onAbort: () => trace.finalize("aborted"),
          onError: (error) => trace.fail(error),
          onFinish: ({ totalUsage, finishReason }) => {
            trace.finalize("completed", totalUsage, finishReason);
            const delta = totalUsage.totalTokens;
            if (typeof delta === "number" && delta > 0) {
              addSessionTokens(sessionId, delta);
            }
          },
        });

        writer.merge(
          result.toUIMessageStream<AntonUIMessage>({
            sendReasoning: true,
            sendStart: false,
            sendFinish: false,
          }),
        );
      } catch (err) {
        trace.fail(err);
        throw err;
      }
    },
    onFinish: ({ messages, isAborted }) => {
      if (isAborted) return;
      replaceMessages<AntonUIMessage>(sessionId, messages);
    },
  });

  return createUIMessageStreamResponse({ stream });
}

function prepareMessagesForModel(messages: AntonUIMessage[]): AntonUIMessage[] {
  return messages.flatMap((message) => {
    const parts = message.parts
      .filter(isModelContextPart)
      .map(stripProviderReplayMetadata);
    if (!parts.some(isSubstantiveModelContextPart)) return [];
    return [{ ...message, parts }];
  });
}

function isModelContextPart(
  part: AntonUIMessage["parts"][number],
): boolean {
  if (part.type === "reasoning") return false;
  return !part.type.startsWith("data-");
}

function isSubstantiveModelContextPart(
  part: AntonUIMessage["parts"][number],
): boolean {
  return part.type !== "step-start";
}

function stripProviderReplayMetadata(
  part: AntonUIMessage["parts"][number],
): AntonUIMessage["parts"][number] {
  const clone = { ...part } as Record<string, unknown>;
  delete clone.providerMetadata;
  delete clone.callProviderMetadata;
  delete clone.resultProviderMetadata;
  return clone as AntonUIMessage["parts"][number];
}

function createTraceWriter({
  writer,
  runId,
  model,
  startedAt,
}: {
  writer: UIMessageStreamWriter<AntonUIMessage>;
  runId: string;
  model: string;
  startedAt: number;
}) {
  let sequence = 0;
  let finalized = false;
  const events = new Map<string, AntonActivityEvent>();

  const metadata = (
    status: AntonRunStatus,
    extra: Partial<AntonMessageMetadata> = {},
  ): AntonMessageMetadata => ({
    runId,
    model,
    status,
    startedAt,
    ...extra,
  });

  const writeMetadata = (
    status: AntonRunStatus,
    extra: Partial<AntonMessageMetadata> = {},
  ) => {
    writer.write({
      type: "message-metadata",
      messageMetadata: metadata(status, extra),
    });
  };

  const writeRun = (
    status: AntonRunStatus,
    extra: Partial<Omit<AntonRunData, "runId" | "model" | "status" | "startedAt">> = {},
  ) => {
    const data: AntonRunData = {
      runId,
      model,
      status,
      startedAt,
      ...extra,
    };
    writeMetadata(status, extra);
    writer.write({ type: "data-run", id: runId, data });
  };

  const persistEvent = (event: AntonActivityEvent) => {
    upsertRunEvent({
      id: event.id,
      runId: event.runId,
      sequence: event.sequence,
      kind: event.kind,
      status: event.status,
      label: event.label,
      summary: event.summary ?? null,
      startedAt: new Date(event.startedAt),
      finishedAt: event.finishedAt ? new Date(event.finishedAt) : null,
      durationMs: event.durationMs ?? null,
      toolCallId: event.toolCallId ?? null,
      details: event.details ?? null,
    });
  };

  const writeEvent = (event: AntonActivityEvent) => {
    events.set(event.id, event);
    persistEvent(event);
    writer.write({ type: "data-activity", id: event.id, data: event });
  };

  const startEvent = ({
    id,
    kind,
    label,
    summary,
    status = "running",
    toolCallId,
    details,
  }: {
    id: string;
    kind: AntonActivityKind;
    label: string;
    summary?: string;
    status?: AntonActivityStatus;
    toolCallId?: string;
    details?: Record<string, unknown>;
  }) => {
    const event: AntonActivityEvent = {
      id,
      runId,
      sequence: ++sequence,
      kind,
      status,
      label,
      summary,
      startedAt: Date.now(),
      toolCallId,
      details,
    };
    writeEvent(event);
    return event;
  };

  const finishEvent = (
    id: string,
    patch: Partial<
      Pick<
        AntonActivityEvent,
        "status" | "label" | "summary" | "details" | "toolCallId"
      >
    > = {},
  ) => {
    const current = events.get(id);
    if (!current) return;
    const finishedAt = Date.now();
    writeEvent({
      ...current,
      ...patch,
      finishedAt,
      durationMs: Math.max(0, finishedAt - current.startedAt),
    });
  };

  const settleRunningEvents = (status: "completed" | "error") => {
    for (const event of Array.from(events.values())) {
      if (event.status !== "running") continue;
      finishEvent(event.id, { status });
    }
  };

  const summarizeInput = (input: unknown): string | undefined => {
    if (typeof input !== "object" || input === null) return undefined;
    const record = input as Record<string, unknown>;
    for (const key of ["command", "path", "pattern", "slug", "task"]) {
      if (typeof record[key] === "string") return record[key];
    }
    return undefined;
  };

  const toolLabel = (name: string, input: unknown): string => {
    const summary = summarizeInput(input);
    if (name === "bash" && summary) return `Ran ${summary}`;
    if (name === "read_file" && summary) return `Read ${summary}`;
    if (name === "grep" && summary) return `Searched for ${summary}`;
    if (name === "glob" && summary) return `Listed ${summary}`;
    if (name === "write_file" && summary) return `Edited ${summary}`;
    return name;
  };

  const finalize = (
    status: Exclude<AntonRunStatus, "running">,
    usage?: LanguageModelUsage,
    finishReason?: FinishReason,
  ) => {
    if (finalized) return;
    finalized = true;
    settleRunningEvents(status === "completed" ? "completed" : "error");
    const finishedAt = Date.now();
    const durationMs = Math.max(0, finishedAt - startedAt);
    const totalTokens = usage?.totalTokens;
    writeRun(status, { finishedAt, durationMs, totalTokens });
    updateRun(runId, {
      status,
      finishedAt: new Date(finishedAt),
      durationMs,
      totalTokens: totalTokens ?? null,
      finishReason: finishReason ?? null,
    });
  };

  return {
    writeRun,
    startStep(stepNumber: number) {
      startEvent({
        id: `${runId}:step:${stepNumber}`,
        kind: "step",
        label: `Step ${stepNumber + 1}`,
      });
    },
    finishStep(stepNumber: number) {
      finishEvent(`${runId}:step:${stepNumber}`, {
        status: "completed",
        label: `Step ${stepNumber + 1} completed`,
      });
    },
    startTool(event: {
      stepNumber: number | undefined;
      toolCallId: string;
      toolName: string;
      input: unknown;
    }) {
      startEvent({
        id: `${runId}:tool:${event.toolCallId}`,
        kind: "tool",
        label: toolLabel(event.toolName, event.input),
        summary: summarizeInput(event.input),
        toolCallId: event.toolCallId,
        details: { toolName: event.toolName, stepNumber: event.stepNumber },
      });
    },
    finishTool(event: {
      stepNumber: number | undefined;
      toolCallId: string;
      toolName: string;
      input: unknown;
      success: boolean;
      durationMs: number;
      output?: unknown;
      error?: unknown;
    }) {
      finishEvent(`${runId}:tool:${event.toolCallId}`, {
        status: event.success ? "completed" : "error",
        label: toolLabel(event.toolName, event.input),
        summary: summarizeInput(event.input),
        details: {
          toolName: event.toolName,
          stepNumber: event.stepNumber,
          success: event.success,
        },
      });
    },
    handleStreamPart(part: TextStreamPart<ToolSet>) {
      if (part.type === "reasoning-start") {
        startEvent({
          id: `${runId}:reasoning:${part.id}`,
          kind: "reasoning",
          label: "Thinking",
        });
      }
      if (part.type === "reasoning-end") {
        finishEvent(`${runId}:reasoning:${part.id}`, {
          status: "completed",
          label: "Thought",
        });
      }
      if (part.type === "error") {
        startEvent({
          id: `${runId}:error:${sequence + 1}`,
          kind: "error",
          status: "error",
          label: "Stream error",
          summary: errorMessage(part.error),
        });
      }
    },
    fail(error: unknown) {
      startEvent({
        id: `${runId}:error:${sequence + 1}`,
        kind: "error",
        status: "error",
        label: "Run failed",
        summary: errorMessage(error),
      });
      finalize("error");
    },
    finalize,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
