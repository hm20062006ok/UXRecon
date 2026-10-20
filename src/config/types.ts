import type { LogLevel } from "../logging/index.js";

/** Bumping this is a breaking change to config.yaml and needs a migrator. */
export const SUPPORTED_SCHEMA_VERSION = 1;

export interface DeviceConfig {
  /** Full device UDID. Treated as an identifier: masked in logs, required to connect. */
  udid: string;
  name: string;
  platformVersion: string;
}

export interface AppConfig {
  bundleId: string;
}

export interface AppiumConfig {
  host: string;
  port: number;
  basePath: string;
  /** Set to reuse an already-running WebDriverAgent instead of building one. */
  webDriverAgentUrl: string | null;
  xcodeOrgId: string;
  xcodeSigningId: string;
  updatedWDABundleId: string;
  allowProvisioningDeviceRegistration: boolean;
  wdaLaunchTimeoutMs: number;
  wdaConnectionTimeoutMs: number;
  newCommandTimeoutSec: number;
}

export interface SafetyConfig {
  /** Must stay false unless a human approved the exact target in docs/p0-safe-test-scope.md. */
  allowSafeTap: boolean;
  denyKeywords: string[];
  confirmKeywords: string[];
  /** Extra regex sources applied to every log line and artifact string. */
  redactPatterns: string[];
}

export interface ExplorationConfig {
  dryRun: boolean;
  maxPages: number;
  maxActions: number;
  maxDepth: number;
  actionRetryLimit: number;
  scrollLimit: number;
  startActions?: string[] | undefined;
  goal?: string | undefined;
}

export interface RunConfig {
  outputDir: string;
  /** Namespaces runs/<project>/<run-id>. */
  project: string;
}

export interface LoggingConfig {
  level: LogLevel;
  jsonl: boolean;
}

export type AgentProvider = "codex" | "claude" | "gemini" | "opencode" | "custom" | "none";

export interface AgentConfig {
  /** "codex" | "claude" | "gemini" | "custom" | "none". Defaults to "codex". */
  provider: AgentProvider;
  /** Executable binary name or path. Defaults to "codex". */
  command: string;
  /** Model override name, e.g. "gpt-4o", "claude-3-7-sonnet", "gemini-2.5-pro". */
  model: string | null;
  /** Extra CLI flags/arguments passed to the agent command. */
  args: string[];
  /** Execution timeout for agent calls in milliseconds. */
  timeoutMs: number;
}

export interface Config {
  schemaVersion: typeof SUPPORTED_SCHEMA_VERSION;
  device: DeviceConfig;
  app: AppConfig;
  appium: AppiumConfig;
  safety: SafetyConfig;
  exploration: ExplorationConfig;
  agent: AgentConfig;
  run: RunConfig;
  logging: LoggingConfig;
}

export interface LoadConfigOptions {
  /** Explicit path. When omitted the loader searches the standard filenames. */
  configPath?: string | undefined;
  /** Directory used for relative path resolution. Defaults to process.cwd(). */
  cwd?: string | undefined;
  /** Environment used for ${VAR} substitution. Defaults to process.env. */
  env?: NodeJS.ProcessEnv | undefined;
}

/** Filenames probed in order when no explicit --config is given. */
export const CONFIG_FILE_NAMES = ["uxr.config.yaml", "uxr.config.yml", "config.yaml"] as const;
