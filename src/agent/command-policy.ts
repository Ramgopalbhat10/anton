import path from "node:path";

import type { ToolRiskCategory } from "./permissions";

export type BashCommandClassification = {
  categories: readonly ToolRiskCategory[];
  forbidden: boolean;
  reason: string;
};

export type BashCommandPolicyDecision =
  | {
      allowed: true;
      classification: BashCommandClassification;
    }
  | {
      allowed: false;
      classification: BashCommandClassification;
      reason: string;
    };

type ShellOperator = "&&" | "||" | ";" | "|" | "&";
type ShellRedirectionOperator = ">" | ">>" | "<" | "2>" | "2>>";

type ShellToken = {
  value: string;
  raw: string;
  hadExpansion: boolean;
};

type ParsedItem =
  | { kind: "token"; token: ShellToken }
  | { kind: "operator"; operator: ShellOperator }
  | { kind: "redirection"; operator: ShellRedirectionOperator };

type ShellRedirection = {
  operator: ShellRedirectionOperator;
  target?: ShellToken;
};

type ShellSegment = {
  raw: string;
  tokens: ShellToken[];
  argv: ShellToken[];
  executable?: ShellToken;
  redirections: ShellRedirection[];
};

type ShellAnalysis = {
  segments: ShellSegment[];
  operators: ShellOperator[];
  redirections: ShellRedirection[];
  unsupportedReasons: string[];
  securityRelevantUnsupported: boolean;
  targetSensitiveUnsupported: boolean;
};

type ShellTokenizerResult = {
  items: ParsedItem[];
  unsupportedReasons: string[];
  securityRelevantUnsupported: boolean;
};

type UnsupportedCollector = {
  reasons: string[];
  securityRelevant: boolean;
};

const RISK_CATEGORY_ORDER: readonly ToolRiskCategory[] = [
  "read-only",
  "write",
  "delete",
  "network",
  "package-install",
  "git",
  "long-running-process",
  "external-integration",
];

const READ_ONLY_COMMANDS = new Set([
  "awk",
  "basename",
  "cat",
  "dirname",
  "du",
  "echo",
  "file",
  "find",
  "grep",
  "head",
  "jq",
  "ls",
  "pwd",
  "realpath",
  "rg",
  "sed",
  "sort",
  "stat",
  "tail",
  "test",
  "tree",
  "tr",
  "type",
  "wc",
  "which",
]);

const SECRET_READER_COMMANDS = new Set([
  "awk",
  "cat",
  "grep",
  "head",
  "less",
  "more",
  "rg",
  "sed",
  "tail",
  "type",
]);

const WRITE_COMMANDS = new Set([
  "chmod",
  "chown",
  "cp",
  "install",
  "mkdir",
  "mv",
  "tee",
  "touch",
  "truncate",
]);

const DELETE_COMMANDS = new Set(["rm", "rmdir", "unlink"]);

const NETWORK_COMMANDS = new Set([
  "curl",
  "ftp",
  "nc",
  "netcat",
  "rsync",
  "scp",
  "sftp",
  "ssh",
  "telnet",
  "wget",
]);

const EXTERNAL_INTEGRATION_COMMANDS = new Set([
  "aws",
  "az",
  "docker",
  "docker-compose",
  "flyctl",
  "gcloud",
  "gh",
  "kubectl",
  "netlify",
  "railway",
  "stripe",
  "supabase",
  "vercel",
]);

const PACKAGE_MANAGERS = new Set(["bun", "npm", "pnpm", "yarn"]);
const PACKAGE_INSTALL_SUBCOMMANDS = new Set([
  "add",
  "create",
  "dlx",
  "i",
  "init",
  "install",
  "remove",
  "rm",
  "update",
  "upgrade",
]);
const LONG_RUNNING_PACKAGE_COMMANDS = new Set([
  "dev",
  "preview",
  "serve",
  "start",
  "watch",
]);
const LONG_RUNNING_COMMANDS = new Set([
  "htop",
  "less",
  "more",
  "top",
  "watch",
]);
const JS_TOOL_COMMANDS = new Set(["next", "turbo", "vite", "webpack"]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "diff",
  "log",
  "ls-files",
  "rev-parse",
  "show",
  "status",
]);
const WRITE_GIT_SUBCOMMANDS = new Set([
  "add",
  "am",
  "apply",
  "checkout",
  "cherry-pick",
  "commit",
  "merge",
  "mv",
  "rebase",
  "restore",
  "revert",
  "switch",
  "tag",
]);
const NETWORK_GIT_SUBCOMMANDS = new Set([
  "clone",
  "fetch",
  "ls-remote",
  "pull",
  "push",
]);

const NESTED_SHELL_COMMANDS = new Set([
  "bash",
  "cmd",
  "fish",
  "powershell",
  "pwsh",
  "sh",
  "zsh",
]);

const BASH_ENV_ALLOWLIST = new Set([
  "CI",
  "COLORTERM",
  "ComSpec",
  "COMSPEC",
  "FORCE_COLOR",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "NO_COLOR",
  "Path",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SystemRoot",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "USERPROFILE",
  "WINDIR",
  "windir",
]);

const SECRET_FILE_RE =
  /(^|[\s/\\])(?:\.env(?:\.[^/\\\s]+)?|id_rsa|id_dsa|id_ecdsa|id_ed25519|[^/\\\s]*(?:token|secret|credential|private[-_]?key)[^/\\\s]*)(?:$|\s)/i;
const SECRET_NAME_RE =
  /\b(?:api[_-]?key|authorization|bearer|client[_-]?secret|credential|github[_-]?app[_-]?private[_-]?key|openrouter[_-]?api[_-]?key|password|private[_-]?key|secret|token)\b/i;

export function classifyBashCommand(command: string): BashCommandClassification {
  const normalized = command.trim();
  if (!normalized) {
    return {
      categories: ["read-only"],
      forbidden: false,
      reason: "empty command",
    };
  }

  const analysis = analyzeShellCommand(normalized);
  const categories = new Set<ToolRiskCategory>();
  let allSegmentsReadOnly = analysis.segments.length > 0;

  for (const operator of analysis.operators) {
    if (operator === "&") {
      categories.add("long-running-process");
      allSegmentsReadOnly = false;
    }
  }

  for (const redirection of analysis.redirections) {
    if (isWriteRedirection(redirection.operator)) {
      categories.add("write");
      allSegmentsReadOnly = false;
    }
  }

  for (const segment of analysis.segments) {
    const segmentReadOnly = classifySegment(segment, categories);
    if (!segmentReadOnly) {
      allSegmentsReadOnly = false;
    }
  }

  if (analysis.unsupportedReasons.length > 0) {
    categories.add("write");
    allSegmentsReadOnly = false;
  }

  if (allSegmentsReadOnly) {
    categories.add("read-only");
  } else if (categories.size === 0) {
    categories.add("write");
  }

  const orderedCategories = orderedRiskCategories(categories);
  return {
    categories: orderedCategories,
    forbidden: false,
    reason:
      analysis.unsupportedReasons.length > 0
        ? unsupportedReason(analysis.unsupportedReasons)
        : reasonForCategories(orderedCategories),
  };
}

export function evaluateBashCommandPolicy(
  command: string,
  options: { workspaceRoot?: string } = {},
): BashCommandPolicyDecision {
  const classification = classifyBashCommand(command);
  const analysis = analyzeShellCommand(command.trim());
  const violation = firstPolicyViolation(analysis, options.workspaceRoot);
  if (violation) {
    return {
      allowed: false,
      classification: { ...classification, forbidden: true, reason: violation },
      reason: violation,
    };
  }

  return { allowed: true, classification };
}

export function buildBashEnvironment(
  source: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (!isAllowedEnvironmentKey(key)) continue;
    env[key] = value;
  }
  return env;
}

function analyzeShellCommand(command: string): ShellAnalysis {
  const tokenized = tokenizeShell(command);
  const collector: UnsupportedCollector = {
    reasons: [...tokenized.unsupportedReasons],
    securityRelevant: tokenized.securityRelevantUnsupported,
  };
  const segments: ShellSegment[] = [];
  const operators: ShellOperator[] = [];
  const redirections: ShellRedirection[] = [];
  let currentItems: ParsedItem[] = [];

  const pushCurrentSegment = () => {
    const segment = buildSegment(currentItems);
    if (segment) {
      segments.push(segment);
      redirections.push(...segment.redirections);
    }
    currentItems = [];
  };

  for (let i = 0; i < tokenized.items.length; i += 1) {
    const item = tokenized.items[i];
    if (!item) continue;

    if (item.kind === "operator") {
      pushCurrentSegment();
      operators.push(item.operator);
      continue;
    }

    if (item.kind === "redirection") {
      const next = tokenized.items[i + 1];
      currentItems.push(item);
      if (next?.kind === "token") {
        currentItems.push(next);
        i += 1;
      } else {
        collectUnsupported(
          collector,
          "missing redirection target",
          true,
        );
      }
      continue;
    }

    currentItems.push(item);
  }

  pushCurrentSegment();

  let targetSensitiveUnsupported = false;
  for (const segment of segments) {
    if (segment.executable?.hadExpansion) {
      collectUnsupported(
        collector,
        "variable expansion in executable",
        true,
      );
    }
    if (isNestedShellExecution(segment)) {
      collectUnsupported(collector, "nested shell execution", true);
    }

    for (const redirection of segment.redirections) {
      if (redirection.target?.hadExpansion) {
        targetSensitiveUnsupported = true;
        collectUnsupported(
          collector,
          "variable expansion in redirection target",
          false,
        );
      }
    }

    if (hasVariableExpandedPathTarget(segment)) {
      targetSensitiveUnsupported = true;
      collectUnsupported(
        collector,
        "variable expansion in path-sensitive target",
        false,
      );
    }
  }

  return {
    segments,
    operators,
    redirections,
    unsupportedReasons: collector.reasons,
    securityRelevantUnsupported: collector.securityRelevant,
    targetSensitiveUnsupported,
  };
}

function tokenizeShell(command: string): ShellTokenizerResult {
  const items: ParsedItem[] = [];
  const collector: UnsupportedCollector = {
    reasons: [],
    securityRelevant: false,
  };
  let value = "";
  let raw = "";
  let quote: "single" | "double" | null = null;
  let hadExpansion = false;

  const flushToken = () => {
    if (!raw) return;
    items.push({
      kind: "token",
      token: {
        value,
        raw,
        hadExpansion,
      },
    });
    value = "";
    raw = "";
    hadExpansion = false;
  };

  const pushOperator = (operator: ShellOperator) => {
    flushToken();
    items.push({ kind: "operator", operator });
  };

  const pushRedirection = (operator: ShellRedirectionOperator) => {
    flushToken();
    items.push({ kind: "redirection", operator });
  };

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (char === undefined) continue;
    const next = command[i + 1];
    const afterNext = command[i + 2];

    if (quote === null) {
      if (/\s/.test(char)) {
        flushToken();
        continue;
      }

      if (char === "'" || char === '"') {
        quote = char === "'" ? "single" : "double";
        raw += char;
        continue;
      }

      if (char === "$" && next === "(") {
        collectUnsupported(collector, "command substitution", true);
        hadExpansion = true;
        value += "$(";
        raw += "$(";
        i += 1;
        continue;
      }

      if (char === "`") {
        collectUnsupported(collector, "command substitution", true);
        hadExpansion = true;
        value += char;
        raw += char;
        continue;
      }

      if ((char === "<" || char === ">") && next === "(") {
        collectUnsupported(collector, "process substitution", true);
        value += `${char}(`;
        raw += `${char}(`;
        i += 1;
        continue;
      }

      if (char === "<" && next === "<") {
        collectUnsupported(
          collector,
          afterNext === "<" ? "here-string" : "here-doc",
          true,
        );
        flushToken();
        i += afterNext === "<" ? 2 : 1;
        continue;
      }

      if (char === "2" && next === ">") {
        pushRedirection(afterNext === ">" ? "2>>" : "2>");
        i += afterNext === ">" ? 2 : 1;
        continue;
      }

      if (char === ">") {
        pushRedirection(next === ">" ? ">>" : ">");
        if (next === ">") i += 1;
        continue;
      }

      if (char === "<") {
        pushRedirection("<");
        continue;
      }

      if (char === "&" && next === "&") {
        pushOperator("&&");
        i += 1;
        continue;
      }

      if (char === "|" && next === "|") {
        pushOperator("||");
        i += 1;
        continue;
      }

      if (char === "|" && next === "&") {
        collectUnsupported(collector, "stderr pipe operator", true);
        pushOperator("|");
        i += 1;
        continue;
      }

      if (char === "|" || char === ";" || char === "&") {
        pushOperator(char);
        continue;
      }

      if (char === "(" || char === ")") {
        collectUnsupported(collector, "subshell or group expression", true);
        value += char;
        raw += char;
        continue;
      }

      if (char === "$") {
        hadExpansion = true;
      }
    } else {
      if (quote === "single" && char === "'") {
        quote = null;
        raw += char;
        continue;
      }

      if (quote === "double" && char === '"') {
        quote = null;
        raw += char;
        continue;
      }

      if (quote === "double") {
        if (char === "$" && next === "(") {
          collectUnsupported(collector, "command substitution", true);
          hadExpansion = true;
          value += "$(";
          raw += "$(";
          i += 1;
          continue;
        }
        if (char === "`") {
          collectUnsupported(collector, "command substitution", true);
          hadExpansion = true;
        }
        if (char === "$") {
          hadExpansion = true;
        }
      }
    }

    if (char === "\\" && quote !== "single") {
      const escaped = command[i + 1];
      if (escaped !== undefined) {
        value += escaped;
        raw += `${char}${escaped}`;
        i += 1;
        continue;
      }
    }

    value += char;
    raw += char;
  }

  if (quote !== null) {
    collectUnsupported(collector, "unclosed quote", true);
  }
  flushToken();

  return {
    items,
    unsupportedReasons: collector.reasons,
    securityRelevantUnsupported: collector.securityRelevant,
  };
}

function buildSegment(items: readonly ParsedItem[]): ShellSegment | null {
  if (items.length === 0) return null;

  const tokens: ShellToken[] = [];
  const redirections: ShellRedirection[] = [];
  const rawParts: string[] = [];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) continue;

    if (item.kind === "token") {
      tokens.push(item.token);
      rawParts.push(item.token.raw);
      continue;
    }

    if (item.kind === "redirection") {
      const next = items[i + 1];
      const target = next?.kind === "token" ? next.token : undefined;
      redirections.push({ operator: item.operator, target });
      rawParts.push(item.operator);
      if (target) {
        rawParts.push(target.raw);
        i += 1;
      }
    }
  }

  const executableIndex = tokens.findIndex(
    (token) => !isShellAssignment(token.value),
  );
  const executable =
    executableIndex >= 0 ? tokens[executableIndex] : undefined;
  const argv = executableIndex >= 0 ? tokens.slice(executableIndex) : [];

  return {
    raw: rawParts.join(" "),
    tokens,
    argv,
    executable,
    redirections,
  };
}

function classifySegment(
  segment: ShellSegment,
  categories: Set<ToolRiskCategory>,
): boolean {
  const executableName = executableNameForSegment(segment);
  if (!executableName) {
    if (segment.redirections.some((redirect) => isWriteRedirection(redirect.operator))) {
      categories.add("write");
    }
    return false;
  }

  if (DELETE_COMMANDS.has(executableName)) {
    categories.add("delete");
    return false;
  }

  if (WRITE_COMMANDS.has(executableName)) {
    categories.add("write");
    return false;
  }

  if (NETWORK_COMMANDS.has(executableName)) {
    categories.add("network");
    categories.add("external-integration");
    return false;
  }

  if (EXTERNAL_INTEGRATION_COMMANDS.has(executableName)) {
    categories.add("external-integration");
    if (executableName === "gh") categories.add("network");
    return false;
  }

  if (executableName === "git") {
    return classifyGitSegment(segment, categories);
  }

  if (isPackageInstallSegment(executableName, segment)) {
    categories.add("package-install");
    categories.add("write");
    return false;
  }

  if (isPackageLongRunningSegment(executableName, segment)) {
    categories.add("long-running-process");
    return false;
  }

  if (isLongRunningSegment(executableName, segment)) {
    categories.add("long-running-process");
    return false;
  }

  if (isInlineWriteSegment(executableName, segment)) {
    categories.add("write");
    return false;
  }

  if (executableName === "find" && hasArg(segment, "-delete")) {
    categories.add("delete");
    return false;
  }

  if (executableName === "find" && hasAnyArg(segment, ["-exec", "-execdir"])) {
    categories.add("write");
    return false;
  }

  if (READ_ONLY_COMMANDS.has(executableName)) {
    return !segment.redirections.some((redirect) =>
      isWriteRedirection(redirect.operator),
    );
  }

  categories.add("write");
  return false;
}

function classifyGitSegment(
  segment: ShellSegment,
  categories: Set<ToolRiskCategory>,
): boolean {
  categories.add("git");
  const parsed = parseGitSubcommand(segment);
  if (!parsed.subcommand) {
    return false;
  }

  if (READ_ONLY_GIT_SUBCOMMANDS.has(parsed.subcommand)) {
    return true;
  }

  if (parsed.subcommand === "branch") {
    if (isReadOnlyGitBranch(parsed.args)) return true;
    categories.add("write");
    return false;
  }

  if (parsed.subcommand === "submodule" && parsed.args[0] === "update") {
    categories.add("network");
    categories.add("external-integration");
    categories.add("write");
    return false;
  }

  if (NETWORK_GIT_SUBCOMMANDS.has(parsed.subcommand)) {
    categories.add("network");
    categories.add("external-integration");
    if (parsed.subcommand !== "ls-remote") {
      categories.add("write");
    }
    return false;
  }

  if (parsed.subcommand === "clean") {
    categories.add("delete");
    return false;
  }

  if (parsed.subcommand === "reset") {
    categories.add(hasAnyArgValue(parsed.args, ["--hard"]) ? "delete" : "write");
    return false;
  }

  if (WRITE_GIT_SUBCOMMANDS.has(parsed.subcommand)) {
    categories.add("write");
    return false;
  }

  categories.add("write");
  return false;
}

function firstPolicyViolation(
  analysis: ShellAnalysis,
  workspaceRoot: string | undefined,
): string | null {
  if (analysis.segments.length === 0) return null;

  const unsupported = unsupportedSyntaxViolation(analysis);
  if (unsupported) return unsupported;

  for (const segment of analysis.segments) {
    const executableName = executableNameForSegment(segment);
    if (executableName === "sudo" || executableName === "su") {
      return "refuses privileged shell commands";
    }
    if (executableName === "env" || executableName === "printenv" || executableName === "set") {
      return "refuses commands that print the shell environment";
    }
  }

  return (
    readsSecretTargetViolation(analysis) ??
    destructiveTargetViolation(analysis) ??
    gitPolicyViolation(analysis) ??
    absolutePathViolation(analysis) ??
    redirectionViolation(analysis, workspaceRoot)
  );
}

function unsupportedSyntaxViolation(analysis: ShellAnalysis): string | null {
  if (
    !analysis.securityRelevantUnsupported &&
    !analysis.targetSensitiveUnsupported
  ) {
    return null;
  }
  return unsupportedReason(analysis.unsupportedReasons);
}

function readsSecretTargetViolation(analysis: ShellAnalysis): string | null {
  for (const segment of analysis.segments) {
    const executableName = executableNameForSegment(segment);
    if (!executableName || !SECRET_READER_COMMANDS.has(executableName)) {
      continue;
    }

    for (const token of segment.argv.slice(1)) {
      if (SECRET_FILE_RE.test(`${token.value} `) || SECRET_NAME_RE.test(token.value)) {
        return "refuses commands that read or search likely secret files or values";
      }
    }
  }
  return null;
}

function destructiveTargetViolation(analysis: ShellAnalysis): string | null {
  for (const segment of analysis.segments) {
    const executableName = executableNameForSegment(segment);
    if (!executableName) continue;
    if (executableName === "find" && hasArg(segment, "-delete")) {
      for (const target of findSearchRoots(segment)) {
        if (
          isRootHomeCurrentOrParentTarget(target.value) ||
          isWorkspaceWideGlob(target.value) ||
          targetsParentDirectory(target.value)
        ) {
          return "refuses destructive filesystem commands aimed at root, home, parent, current directory, or workspace-wide wildcards";
        }
      }
      continue;
    }
    if (!DELETE_COMMANDS.has(executableName)) continue;

    for (const target of commandTargets(segment)) {
      if (target.hadExpansion) {
        return "refuses destructive filesystem commands with variable-expanded targets";
      }

      if (isRootHomeCurrentOrParentTarget(target.value) || isWorkspaceWideGlob(target.value)) {
        return "refuses destructive filesystem commands aimed at root, home, parent, current directory, or workspace-wide wildcards";
      }

      if (targetsParentDirectory(target.value)) {
        return "refuses destructive filesystem commands targeting parent directories";
      }
    }
  }
  return null;
}

function gitPolicyViolation(analysis: ShellAnalysis): string | null {
  for (const segment of analysis.segments) {
    if (executableNameForSegment(segment) !== "git") continue;
    const parsed = parseGitSubcommand(segment);
    if (!parsed.subcommand) continue;

    if (parsed.subcommand === "clean") {
      return "refuses destructive git cleanup commands";
    }

    if (parsed.subcommand === "reset" && hasAnyArgValue(parsed.args, ["--hard"])) {
      return "refuses destructive git reset commands";
    }

    if (parsed.subcommand === "push" && hasGitForcePushArg(parsed.args)) {
      return "refuses force-push commands";
    }
  }
  return null;
}

function absolutePathViolation(analysis: ShellAnalysis): string | null {
  for (const token of allTokens(analysis)) {
    if (isUrl(token.value) || token.value.startsWith("-")) continue;
    if (isAbsoluteFilesystemPath(token.value)) {
      return "refuses absolute filesystem paths in shell commands";
    }
  }
  return null;
}

function redirectionViolation(
  analysis: ShellAnalysis,
  workspaceRoot: string | undefined,
): string | null {
  for (const redirection of analysis.redirections) {
    if (!isWriteRedirection(redirection.operator)) continue;
    const target = redirection.target;
    if (!target || target.value === "/dev/null") continue;
    if (target.hadExpansion) {
      return "refuses shell redirection with variable-expanded targets";
    }
    if (target.value === ".." || target.value.startsWith("../") || target.value.startsWith("..\\")) {
      return "refuses shell redirection outside the workspace";
    }
    if (isAbsoluteFilesystemPath(target.value)) {
      if (!workspaceRoot) return "refuses absolute shell redirection targets";
      if (!isInside(path.resolve(target.value), path.resolve(workspaceRoot))) {
        return "refuses shell redirection outside the workspace";
      }
    }
  }
  return null;
}

function executableNameForSegment(segment: ShellSegment): string | undefined {
  const executable = segment.executable?.value;
  if (!executable) return undefined;
  const base = path.basename(executable).toLowerCase();
  return base.endsWith(".exe") ? base.slice(0, -4) : base;
}

function isPackageInstallSegment(
  executableName: string,
  segment: ShellSegment,
): boolean {
  if (executableName === "npx") return true;
  if (executableName === "pip" || executableName === "pip3") {
    return segment.argv[1]?.value === "install";
  }
  if (executableName === "uv") {
    const subcommand = segment.argv[1]?.value;
    if (subcommand === "pip") return segment.argv[2]?.value === "install";
    return subcommand !== undefined && ["add", "remove", "sync"].includes(subcommand);
  }
  if (executableName === "poetry") {
    return hasAnyArgValue(segment.argv.slice(1).map((token) => token.value), [
      "add",
      "install",
      "remove",
      "update",
    ]);
  }
  if (executableName === "cargo") return segment.argv[1]?.value === "install";
  if (executableName === "go") {
    return hasAnyArgValue(segment.argv.slice(1).map((token) => token.value), [
      "get",
      "install",
    ]);
  }
  if (executableName === "gem") return segment.argv[1]?.value === "install";
  if (executableName === "bundle") {
    return hasAnyArgValue(segment.argv.slice(1).map((token) => token.value), [
      "add",
      "install",
      "update",
    ]);
  }
  if (executableName === "composer") {
    return hasAnyArgValue(segment.argv.slice(1).map((token) => token.value), [
      "install",
      "remove",
      "require",
      "update",
    ]);
  }
  if (!PACKAGE_MANAGERS.has(executableName)) return false;
  const subcommand = packageSubcommand(segment);
  return (
    subcommand !== undefined &&
    PACKAGE_INSTALL_SUBCOMMANDS.has(subcommand)
  );
}

function isPackageLongRunningSegment(
  executableName: string,
  segment: ShellSegment,
): boolean {
  if (!PACKAGE_MANAGERS.has(executableName)) return false;
  const subcommand = packageSubcommand(segment);
  if (!subcommand) return false;
  if (LONG_RUNNING_PACKAGE_COMMANDS.has(subcommand)) return true;
  if (subcommand !== "run") return false;
  const scriptName = segment.argv[2]?.value;
  return scriptName !== undefined && LONG_RUNNING_PACKAGE_COMMANDS.has(scriptName);
}

function isLongRunningSegment(
  executableName: string,
  segment: ShellSegment,
): boolean {
  if (LONG_RUNNING_COMMANDS.has(executableName)) return true;
  if (executableName === "tail" && hasShortFlag(segment, "f")) return true;
  if (JS_TOOL_COMMANDS.has(executableName)) {
    const subcommand = segment.argv[1]?.value;
    return subcommand !== undefined && LONG_RUNNING_PACKAGE_COMMANDS.has(subcommand);
  }
  if (executableName === "nodemon" || executableName === "ts-node-dev") {
    return true;
  }
  if (executableName === "tsx" && segment.argv[1]?.value === "watch") {
    return true;
  }
  if (
    (executableName === "python" || executableName === "python3") &&
    segment.argv[1]?.value === "-m" &&
    segment.argv[2]?.value === "http.server"
  ) {
    return true;
  }
  if (executableName === "sleep") {
    const seconds = Number(segment.argv[1]?.value ?? "0");
    return Number.isFinite(seconds) && seconds >= 30;
  }
  return false;
}

function isInlineWriteSegment(
  executableName: string,
  segment: ShellSegment,
): boolean {
  if ((executableName === "sed" || executableName === "perl") && hasShortFlag(segment, "i")) {
    return true;
  }
  return false;
}

function parseGitSubcommand(segment: ShellSegment): {
  subcommand?: string;
  args: string[];
} {
  const args = segment.argv.slice(1).map((token) => token.value);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--") {
      const subcommand = args[index + 1];
      return subcommand
        ? { subcommand: subcommand.toLowerCase(), args: args.slice(index + 2) }
        : { args: [] };
    }
    if (!arg.startsWith("-")) {
      return { subcommand: arg.toLowerCase(), args: args.slice(index + 1) };
    }
    if (gitGlobalOptionTakesValue(arg)) {
      index += arg.includes("=") ? 0 : 1;
    }
  }
  return { args: [] };
}

function gitGlobalOptionTakesValue(arg: string): boolean {
  return (
    arg === "-C" ||
    arg === "-c" ||
    arg === "--git-dir" ||
    arg === "--namespace" ||
    arg === "--work-tree" ||
    arg.startsWith("--git-dir=") ||
    arg.startsWith("--namespace=") ||
    arg.startsWith("--work-tree=")
  );
}

function isReadOnlyGitBranch(args: readonly string[]): boolean {
  const writeFlags = new Set([
    "-D",
    "-M",
    "-c",
    "-d",
    "-m",
    "--copy",
    "--delete",
    "--move",
  ]);
  for (const arg of args) {
    if (writeFlags.has(arg)) return false;
    if (!arg.startsWith("-")) return false;
  }
  return true;
}

function packageSubcommand(segment: ShellSegment): string | undefined {
  const candidate = segment.argv[1]?.value;
  return candidate?.toLowerCase();
}

function hasShortFlag(segment: ShellSegment, flag: string): boolean {
  return segment.argv
    .slice(1)
    .some((token) => token.value === `-${flag}` || /^-[A-Za-z]+$/.test(token.value) && token.value.includes(flag));
}

function hasArg(segment: ShellSegment, arg: string): boolean {
  return segment.argv.some((token) => token.value === arg);
}

function hasAnyArg(segment: ShellSegment, args: readonly string[]): boolean {
  return segment.argv.some((token) => args.includes(token.value));
}

function hasAnyArgValue(
  values: readonly string[],
  matches: readonly string[],
): boolean {
  return values.some((value) => matches.includes(value));
}

function hasGitForcePushArg(args: readonly string[]): boolean {
  return args.some(
    (arg) =>
      arg === "-f" ||
      arg === "--force" ||
      arg === "--force-with-lease" ||
      arg === "--mirror",
  );
}

function commandTargets(segment: ShellSegment): ShellToken[] {
  const targets: ShellToken[] = [];
  let afterDoubleDash = false;
  for (const token of segment.argv.slice(1)) {
    if (!afterDoubleDash && token.value === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && token.value.startsWith("-")) continue;
    targets.push(token);
  }
  return targets;
}

function findSearchRoots(segment: ShellSegment): ShellToken[] {
  const roots: ShellToken[] = [];
  for (const token of segment.argv.slice(1)) {
    if (token.value === "--") continue;
    if (
      token.value.startsWith("-") ||
      token.value === "!" ||
      token.value === "(" ||
      token.value === ")"
    ) {
      break;
    }
    roots.push(token);
  }
  return roots.length > 0
    ? roots
    : [{ value: ".", raw: ".", hadExpansion: false }];
}

function hasVariableExpandedPathTarget(segment: ShellSegment): boolean {
  const executableName = executableNameForSegment(segment);
  if (!executableName) return false;
  if (
    DELETE_COMMANDS.has(executableName) ||
    WRITE_COMMANDS.has(executableName) ||
    SECRET_READER_COMMANDS.has(executableName)
  ) {
    return commandTargets(segment).some((target) => target.hadExpansion);
  }
  return false;
}

function isNestedShellExecution(segment: ShellSegment): boolean {
  const executableName = executableNameForSegment(segment);
  if (!executableName || !NESTED_SHELL_COMMANDS.has(executableName)) {
    return false;
  }

  if (executableName === "cmd") {
    return segment.argv
      .slice(1)
      .some((token) => token.value.toLowerCase() === "/c");
  }

  if (executableName === "powershell" || executableName === "pwsh") {
    return segment.argv.slice(1).some((token) => {
      const value = token.value.toLowerCase();
      return value === "-command" || value === "-c" || value === "/c";
    });
  }

  return segment.argv.slice(1).some((token) => {
    const value = token.value.toLowerCase();
    return value === "-c" || value === "-lc" || value === "-cl";
  });
}

function allTokens(analysis: ShellAnalysis): ShellToken[] {
  return analysis.segments.flatMap((segment) => [
    ...segment.tokens,
    ...segment.redirections
      .map((redirection) => redirection.target)
      .filter((target): target is ShellToken => target !== undefined),
  ]);
}

function isShellAssignment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(value);
}

function isWriteRedirection(operator: ShellRedirectionOperator): boolean {
  return operator === ">" || operator === ">>" || operator === "2>" || operator === "2>>";
}

function isRootHomeCurrentOrParentTarget(value: string): boolean {
  return ["/", "\\", "~", ".", "..", "./", ".\\"].includes(value) ||
    value.startsWith("~/");
}

function targetsParentDirectory(value: string): boolean {
  return (
    value.startsWith("../") ||
    value.startsWith("..\\") ||
    value.includes("/../") ||
    value.includes("\\..\\")
  );
}

function isWorkspaceWideGlob(value: string): boolean {
  if (["*", "**", "./*", ".\\*", "./**", ".\\**"].includes(value)) {
    return true;
  }
  return !/[\\/]/.test(value) && value.includes("*");
}

function isAbsoluteFilesystemPath(value: string): boolean {
  return (
    path.isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\")
  );
}

function isUrl(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value);
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isAllowedEnvironmentKey(key: string): boolean {
  return BASH_ENV_ALLOWLIST.has(key) || key.startsWith("LC_");
}

function orderedRiskCategories(
  categories: ReadonlySet<ToolRiskCategory>,
): ToolRiskCategory[] {
  return RISK_CATEGORY_ORDER.filter((category) => categories.has(category));
}

function reasonForCategories(categories: readonly ToolRiskCategory[]): string {
  if (categories.length === 1 && categories[0] === "read-only") {
    return "matched read-only command structure";
  }
  return `matched ${categories.join(", ")} command risk structure`;
}

function unsupportedReason(reasons: readonly string[]): string {
  const unique = [...new Set(reasons)];
  if (unique.length === 0) return "unsupported shell syntax requires approval";
  return `unsupported shell syntax requires approval: ${unique.join(", ")}`;
}

function collectUnsupported(
  collector: UnsupportedCollector,
  reason: string,
  securityRelevant: boolean,
): void {
  if (!collector.reasons.includes(reason)) {
    collector.reasons.push(reason);
  }
  if (securityRelevant) {
    collector.securityRelevant = true;
  }
}
