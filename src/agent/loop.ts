import {
  streamText,
  stepCountIs,
  type ModelMessage,
  type UIMessage,
  type InferUITools,
} from "ai";
import { openrouter, DEFAULT_MODEL } from "@/src/lib/providers";
import { antonTools } from "./tools";
import { workspaceRelative, ensureWorkspaceRoot } from "./sandbox";

const MAX_STEPS = 20;

function systemPrompt(): string {
  const root = ensureWorkspaceRoot();
  const rel = workspaceRelative(root);
  return [
    "You are Anton, a minimal coding-agent harness. Your job is to explore, read,",
    "and modify code inside a sandboxed workspace directory on the user's machine.",
    "",
    `The workspace root is \`${rel === "." ? root : rel}\`. All file paths you pass to tools must be relative to this root.`,
    "Absolute paths and `..` traversal are rejected by the sandbox before execution.",
    "",
    "Tools available:",
    "- `read_file(path, startLine?, endLine?)` — read a text file. Prefer narrow ranges for large files.",
    "- `write_file(path, content)` — overwrite a file. Destructive; the user must approve each call.",
    "- `bash(command, timeoutMs?)` — run a shell command in the workspace. Destructive; requires approval. `sudo` is forbidden.",
    "- `grep(pattern, path?, glob?, caseInsensitive?)` — ripgrep-style search. Use this before reading large files.",
    "- `glob(pattern, path?)` — list files matching a glob like `**/*.ts`.",
    "",
    "Conventions:",
    "- Answer concisely. Prefer short, correct answers over long hedged ones.",
    "- Plan first for multi-step tasks: explore (`glob`, `grep`, `read_file`) before editing (`write_file`).",
    "- When you finish, summarize what you changed and why in one short paragraph.",
    "- Do not guess file contents — read them first.",
    "- Never ask the user for approval in prose; the harness shows an approval UI for risky tools.",
    "- If a tool returns `{ ok: false, error }`, report the error and try a different approach; do not retry the exact same call.",
  ].join("\n");
}

export type AntonUIMessage = UIMessage<
  never,
  never,
  InferUITools<typeof antonTools>
>;

export function runAgent({
  messages,
  model,
}: {
  messages: ModelMessage[];
  model?: string;
}) {
  return streamText({
    model: openrouter(model ?? DEFAULT_MODEL),
    system: systemPrompt(),
    messages,
    tools: antonTools,
    stopWhen: stepCountIs(MAX_STEPS),
  });
}
