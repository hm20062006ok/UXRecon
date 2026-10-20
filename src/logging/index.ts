import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createRedactor, type Redactor } from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  readonly phase: string;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Same sink, same level, different phase and inherited fields. */
  child(phase: string, fields?: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel | undefined;
  phase?: string | undefined;
  /** When set, every record is also appended to this JSONL file. */
  jsonlPath?: string | undefined;
  redactor?: Redactor | undefined;
  /** Test seam: replaces the stderr writer. */
  write?: ((line: string) => void) | undefined;
  /** Test seam: fixed clock. */
  now?: (() => Date) | undefined;
}

function renderFieldValue(value: unknown): string {
  if (typeof value === "string") return /[\s"]/.test(value) ? JSON.stringify(value) : value;
  if (value === undefined) return "undefined";
  if (typeof value === "symbol" || typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[unserializable]";
  try {
    const serialised = JSON.stringify(value);
    return serialised ?? "[unserializable]";
  } catch {
    return "[unserializable]";
  }
}

function safeJsonlLine(record: Record<string, unknown>): string {
  const replacer = (_key: string, val: unknown): unknown => {
    if (typeof val === "bigint" || typeof val === "symbol") return val.toString();
    if (typeof val === "function") return undefined;
    return val;
  };
  try {
    return JSON.stringify(record, replacer);
  } catch {
    const fallback: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      try {
        JSON.stringify(v, replacer);
        fallback[k] = v;
      } catch {
        fallback[k] = "[unserializable]";
      }
    }
    return JSON.stringify(fallback, replacer);
  }
}

class StructuredLogger implements Logger {
  readonly phase: string;

  private readonly level: LogLevel;
  private readonly baseFields: LogFields;
  private readonly jsonlPath: string | undefined;
  private readonly redactor: Redactor;
  private readonly write: (line: string) => void;
  private readonly now: () => Date;

  constructor(options: LoggerOptions, phase: string, baseFields: LogFields) {
    this.level = options.level ?? "info";
    this.phase = phase;
    this.baseFields = baseFields;
    this.jsonlPath = options.jsonlPath;
    this.redactor = options.redactor ?? createRedactor();
    this.write = options.write ?? ((line) => process.stderr.write(`${line}\n`));
    this.now = options.now ?? (() => new Date());

    if (this.jsonlPath !== undefined) {
      mkdirSync(path.dirname(this.jsonlPath), { recursive: true });
    }
  }

  private emit(level: LogLevel, message: string, fields: LogFields | undefined): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;

    const timestamp = this.now().toISOString();
    const merged = { ...this.baseFields, ...fields };
    const redactedMessage = this.redactor.redactText(message);
    const redactedFields = this.redactor.redactValue(merged) as LogFields;

    const suffix = Object.entries(redactedFields)
      .map(([key, value]) => ` ${key}=${renderFieldValue(value)}`)
      .join("");
    this.write(`${timestamp} ${level.toUpperCase().padEnd(5)} [${this.phase}] ${redactedMessage}${suffix}`);

    if (this.jsonlPath !== undefined) {
      const record: Record<string, unknown> = {
        ts: timestamp,
        level,
        phase: this.phase,
        msg: redactedMessage,
        ...redactedFields,
      };
      // Synchronous append: a line either lands complete or not at all, even after SIGKILL.
      const line = safeJsonlLine(record);
      appendFileSync(this.jsonlPath, `${line}\n`, "utf8");
    }
  }

  debug(message: string, fields?: LogFields): void {
    this.emit("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.emit("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.emit("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.emit("error", message, fields);
  }

  child(phase: string, fields?: LogFields): Logger {
    return new StructuredLogger(
      {
        level: this.level,
        jsonlPath: this.jsonlPath,
        redactor: this.redactor,
        write: this.write,
        now: this.now,
      },
      phase,
      { ...this.baseFields, ...fields },
    );
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new StructuredLogger(options, options.phase ?? "app", {});
}

/** Drops everything. Use in unit tests that assert on behaviour, not on logs. */
export function createSilentLogger(): Logger {
  return createLogger({ level: "error", write: () => undefined });
}

export { createRedactor, maskIdentifier, type Redactor, type RedactorOptions } from "./redact.js";
