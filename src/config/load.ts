import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { AppError } from "../errors/index.js";
import { maskIdentifier } from "../logging/redact.js";
import { parseDocument } from "./schema.js";
import { CONFIG_FILE_NAMES, SUPPORTED_SCHEMA_VERSION, type Config, type LoadConfigOptions } from "./types.js";

/** Placeholder used while protecting `$${...}` from substitution. */
const LITERAL_DOLLAR = "\u0000uxr-literal-dollar\u0000";
const ENV_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const BARE_SCALAR = /^[A-Za-z0-9_./@+-]+$/;

const FULL_REDACT_KEY =
  /(secret|token|password|passphrase|mnemonic|seed|private[_-]?key|api[_-]?key|authorization|cookie|credential)/i;

const REQUIRED_FIELDS: ReadonlyArray<{ readonly field: string; readonly why: string }> = [
  { field: "device.udid", why: "the iPhone UDID — run `xcrun devicectl list devices`" },
  {
    field: "device.platformVersion",
    why: 'the iOS version, e.g. "27.0" — run `xcrun devicectl device info details --device <udid>`',
  },
  { field: "app.bundleId", why: "the target app bundle id, e.g. com.global.wallet.ios" },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readPath(document: object, dotted: string): unknown {
  let current: unknown = document;
  for (const segment of dotted.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Environment values are strings, but YAML needs them quoted when they contain
 * `:`, `#`, quotes or leading/trailing space. Bare-looking values are left alone
 * so `port: ${PORT}` still produces a number.
 */
function yamlScalar(value: string): string {
  return BARE_SCALAR.test(value) ? value : JSON.stringify(value);
}

/**
 * Finds the index where a YAML comment starts, respecting quoted scalars.
 * Substitution must not run inside comments: `${VAR}` is the normal way to
 * document this file, and it would otherwise demand a variable nobody uses.
 */
function commentStartIndex(line: string): number {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === '"') {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (index === 0 || /\s/.test(line[index - 1] ?? ""))) return index;
  }
  return -1;
}

/**
 * Replaces `${VAR}` and `${VAR:-fallback}` in the raw YAML text, before parsing,
 * so a single placeholder can carry a host, a bundle id or a port. `$${VAR}`
 * survives as a literal `${VAR}`, and comments are left untouched.
 *
 * Block scalars (`|` / `>`) are treated as ordinary lines, so a `#` inside one
 * is read as a comment. Keep placeholders out of block scalars.
 */
export function substituteEnv(raw: string, env: NodeJS.ProcessEnv, source: string): string {
  const missing: string[] = [];
  const escaped = raw.replaceAll("$${", `${LITERAL_DOLLAR}{`);

  const replaceIn = (text: string): string =>
    text.replace(ENV_PATTERN, (_match, name: string, fallback?: string) => {
      const value = env[name];
      if (value !== undefined && value !== "") return yamlScalar(value);
      if (fallback !== undefined) return yamlScalar(fallback);
      missing.push(name);
      return "";
    });

  const substituted = escaped
    .split("\n")
    .map((line) => {
      const comment = commentStartIndex(line);
      if (comment < 0) return replaceIn(line);
      return `${replaceIn(line.slice(0, comment))}${line.slice(comment)}`;
    })
    .join("\n");

  if (missing.length > 0) {
    const unique = [...new Set(missing)].sort();
    const plural = unique.length > 1;
    throw new AppError(
      "UXR-CFG-004",
      `${source} references environment variable${plural ? "s" : ""} that ${plural ? "are" : "is"} not set: ${unique.join(", ")}`,
      { exitCode: 2, context: { source, variables: unique.join(",") } },
    );
  }

  return substituted.replaceAll(`${LITERAL_DOLLAR}{`, "${");
}

function assertRequiredFields(document: object, source: string): void {
  const missing = REQUIRED_FIELDS.filter(({ field }) => {
    const value = readPath(document, field);
    return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
  });
  if (missing.length === 0) return;

  const lines = missing.map(({ field, why }) => `  - ${field}: ${why}`).join("\n");
  throw new AppError("UXR-CFG-003", `Missing required configuration in ${source}:\n${lines}`, {
    exitCode: 2,
    context: { source, fields: missing.map((entry) => entry.field).join(",") },
  });
}

function assertSchemaVersion(document: object, source: string): void {
  const declared = readPath(document, "schemaVersion");
  if (declared === undefined || declared === null) return;
  if (declared !== SUPPORTED_SCHEMA_VERSION) {
    const declaredText =
      typeof declared === "number" || typeof declared === "string"
        ? String(declared)
        : JSON.stringify(declared);
    throw new AppError(
      "UXR-CFG-005",
      `${source} declares schemaVersion ${declaredText} but this build understands ${SUPPORTED_SCHEMA_VERSION}`,
      { exitCode: 2, context: { source } },
    );
  }
}

/** Parses configuration text. Exposed so tests and `config validate` avoid the filesystem. */
export function parseConfig(raw: string, source: string, env: NodeJS.ProcessEnv = process.env): Config {
  const substituted = substituteEnv(raw, env, source);

  let document: unknown;
  try {
    document = YAML.parse(substituted) as unknown;
  } catch (error) {
    throw new AppError("UXR-CFG-002", `Cannot parse YAML in ${source}: ${errorMessage(error)}`, {
      cause: error,
      exitCode: 2,
      context: { source },
    });
  }

  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    throw new AppError(
      "UXR-CFG-003",
      `${source} must contain a YAML mapping with at least device and app sections`,
      { exitCode: 2, context: { source } },
    );
  }

  assertRequiredFields(document, source);
  assertSchemaVersion(document, source);
  return parseDocument(document, source);
}

export interface ResolvedConfigPath {
  path: string;
  /** False when the file was discovered rather than passed explicitly. */
  explicit: boolean;
}

export function resolveConfigPath(options: LoadConfigOptions = {}): ResolvedConfigPath {
  const cwd = options.cwd ?? process.cwd();
  const explicit = options.configPath;

  if (explicit !== undefined && explicit !== "") {
    const resolved = path.resolve(cwd, explicit);
    if (!existsSync(resolved)) {
      throw new AppError("UXR-CFG-001", `Configuration file not found: ${resolved}`, {
        exitCode: 2,
        context: { path: resolved },
      });
    }
    return { path: resolved, explicit: true };
  }

  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(cwd, name);
    if (existsSync(candidate)) return { path: candidate, explicit: false };
  }

  throw new AppError(
    "UXR-CFG-001",
    `No configuration file found in ${cwd}. Looked for: ${CONFIG_FILE_NAMES.join(", ")}`,
    { exitCode: 2, context: { cwd } },
  );
}

export function loadConfig(options: LoadConfigOptions = {}): Config {
  const { path: file } = resolveConfigPath(options);
  const raw = readFileSync(file, "utf8");
  return parseConfig(raw, file, options.env ?? process.env);
}

function sanitise(value: unknown, key: string | undefined): unknown {
  if (key === "udid" && typeof value === "string") return maskIdentifier(value);
  if (Array.isArray(value)) return value.map((item) => sanitise(item, undefined));
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (FULL_REDACT_KEY.test(entryKey)) continue;
      result[entryKey] = sanitise(entryValue, entryKey);
    }
    return result;
  }
  return value;
}

/**
 * A configuration copy that is safe to write to `config.snapshot.json` and to
 * log. The device UDID is masked and secret-shaped keys are dropped entirely.
 */
export function toSafeSnapshot(config: Config): Record<string, unknown> {
  const sanitised = sanitise(config, undefined);
  return sanitised !== null && typeof sanitised === "object" && !Array.isArray(sanitised)
    ? (sanitised as Record<string, unknown>)
    : {};
}
