export const REDACTED = "[redacted]";

const SECRET_KEY_RE =
  /(?:api[_-]?key|authorization|bearer|client[_-]?secret|credential|password|private[_-]?key|secret|token)/i;

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
  return SECRET_KEY_RE.test(key);
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
