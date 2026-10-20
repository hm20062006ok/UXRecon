/**
 * Redaction is applied on the way out of the process, never at the call site,
 * so a log statement cannot leak a secret by forgetting to mask it.
 */

const FULL_REDACT_KEY =
  /(secret|token|password|passphrase|mnemonic|seed|private[_-]?key|api[_-]?key|authorization|cookie|credential)/i;

const PARTIAL_REDACT_KEY = /(udid|serial|ecid|device[_-]?id)/i;

const REDACTED = "***";
const MAX_DEPTH = 6;

export interface RedactorOptions {
  /** Extra patterns applied to every string value, e.g. a project-specific key format. */
  patterns?: readonly RegExp[];
}

export interface Redactor {
  redactValue(value: unknown): unknown;
  redactText(text: string): string;
}

/** Keeps enough of a long identifier to recognise it in a report, not enough to reuse it. */
export function maskIdentifier(value: string): string {
  if (value.length < 16) return REDACTED;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function createRedactor(options: RedactorOptions = {}): Redactor {
  const patterns = options.patterns ?? [];

  const redactText = (text: string): string => {
    let result = text;
    for (const pattern of patterns) {
      // A fresh lastIndex per call keeps stateful /g regexes from skipping matches.
      const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
      result = result.replace(new RegExp(pattern.source, flags), REDACTED);
    }
    return result;
  };

  const redactValue = (
    value: unknown,
    key: string | undefined,
    depth: number,
    seen: WeakSet<object>,
  ): unknown => {
    if (key !== undefined) {
      if (FULL_REDACT_KEY.test(key)) return REDACTED;
      if (PARTIAL_REDACT_KEY.test(key) && typeof value === "string") return maskIdentifier(value);
    }

    if (typeof value === "string") return redactText(value);
    if (value === null || typeof value !== "object") return value;
    if (depth >= MAX_DEPTH) return "[depth-limit]";
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, undefined, depth + 1, seen));
    }
    if (value instanceof Error) {
      return { name: value.name, message: redactText(value.message) };
    }

    const result: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      result[entryKey] = redactValue(entryValue, entryKey, depth + 1, seen);
    }
    return result;
  };

  return {
    redactText,
    redactValue: (value: unknown) => redactValue(value, undefined, 0, new WeakSet<object>()),
  };
}
