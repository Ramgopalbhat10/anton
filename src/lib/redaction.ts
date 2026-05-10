export const REDACTED = "[redacted]";

const NON_SECRET_TOKEN_KEYS = new Set([
  "cached_input_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "input_tokens",
  "max_output_tokens",
  "no_cache_tokens",
  "output_tokens",
  "reasoning_tokens",
  "text_tokens",
  "token_count",
  "tokens_total",
  "total_tokens",
]);

const SECRET_TEXT_PATTERNS: readonly [RegExp, string][] = [
  [
    /\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PRIVATE[_-]?KEY|AUTHORIZATION|CREDENTIAL)[A-Z0-9_]*)=([^\s]+)/gi,
    `$1=${REDACTED}`,
  ],
  [/\b(Authorization:\s*Bearer\s+)([A-Za-z0-9._~+/=-]+)/gi, `$1${REDACTED}`],
  [/\b(Authorization:\s*basic\s+)([A-Za-z0-9+/=-]+)/gi, `$1${REDACTED}`],
  [/\b(AUTHORIZATION:\s*basic\s+)([A-Za-z0-9+/=-]+)/gi, `$1${REDACTED}`],
  [/\bsk-or-v1-[A-Za-z0-9._-]+/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, REDACTED],
];

export function isRedactedSentinel(value: unknown): boolean {
  return value === REDACTED;
}

export function isSecretKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (NON_SECRET_TOKEN_KEYS.has(normalized)) return false;
  return (
    normalized.includes("api_key") ||
    normalized.includes("authorization") ||
    normalized.includes("bearer") ||
    normalized.includes("client_secret") ||
    normalized.includes("credential") ||
    normalized.includes("password") ||
    normalized.includes("private_key") ||
    normalized.includes("secret") ||
    normalized.split("_").includes("token")
  );
}

export function redactText(value: string): string {
  return SECRET_TEXT_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
}

export function redactValue(value: unknown, keyHint?: string): unknown {
  if (typeof keyHint === "string" && isSecretKey(keyHint)) {
    return REDACTED;
  }
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        redactValue(item, key),
      ]),
    );
  }
  return value;
}

export function redactRecordSecrets(
  record: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      isSecretKey(key) ? REDACTED : redactText(value),
    ]),
  );
}

export function preserveRedactedRecordValues(
  next: Record<string, string>,
  current: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(next).map(([key, value]) => [
      key,
      isRedactedSentinel(value) && key in current ? current[key] : value,
    ]),
  );
}

function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join("_");
}
