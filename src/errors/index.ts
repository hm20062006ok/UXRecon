import { errorCatalog, type ErrorCode } from "./catalog.js";

export interface AppErrorOptions {
  /** Overrides the catalogue hint. Use when the fix depends on the situation. */
  hint?: string;
  /** Structured, already-redacted context. Never put secrets here. */
  context?: Record<string, unknown>;
  cause?: unknown;
  exitCode?: number;
}

/**
 * The only error type the CLI is allowed to print verbatim. Anything else is
 * treated as a bug and reported as UXR-INT-001 with a stack trace behind --verbose.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly hint: string;
  readonly exitCode: number;
  readonly context: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.hint = options.hint ?? errorCatalog[code].hint;
    this.exitCode = options.exitCode ?? 1;
    this.context = options.context ?? {};
  }

  get title(): string {
    return errorCatalog[this.code].title;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function toAppError(value: unknown, fallback: ErrorCode = "UXR-INT-001"): AppError {
  if (isAppError(value)) return value;
  const message = value instanceof Error ? value.message : String(value);
  return new AppError(fallback, message, { cause: value });
}

/** Multi-line, human-readable rendering used by the CLI error handler. */
export function describeError(error: AppError): string {
  const lines = [`${error.code} ${error.title}`, `  ${error.message}`, `  Fix: ${error.hint}`];
  const contextEntries = Object.entries(error.context);
  if (contextEntries.length > 0) {
    lines.push(`  Context: ${contextEntries.map(([key, value]) => `${key}=${String(value)}`).join(" ")}`);
  }
  return lines.join("\n");
}

export { errorCatalog, type ErrorCode };
