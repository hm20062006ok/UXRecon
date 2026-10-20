import type { AppError } from "../errors/index.js";
import type { Logger } from "../logging/index.js";
import type { Config } from "../config/types.js";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  /** Stable dotted id, e.g. "xcode.installed". Referenced by docs and tests. */
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  /** Present on warn/fail: the concrete next action. */
  hint?: string;
  durationMs: number;
}

export interface DoctorReport {
  schemaVersion: 1;
  generatedAt: string;
  checks: DoctorCheck[];
  summary: { pass: number; warn: number; fail: number; skip: number; ok: boolean };
}

export interface DoctorContext {
  /** null when configuration could not be loaded; doctor still runs environment checks. */
  config: Config | null;
  configError: AppError | null;
  configPath: string | null;
  logger: Logger;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { timeoutMs?: number | undefined; env?: NodeJS.ProcessEnv | undefined },
) => Promise<CommandResult>;

export type HttpProbe = (
  url: string,
  options?: { timeoutMs?: number | undefined },
) => Promise<{ ok: boolean; status: number; body: string }>;

export interface DoctorOptions {
  configPath?: string | undefined;
  cwd?: string | undefined;
  /** Per-check timeout. Defaults to 20s. */
  timeoutMs?: number | undefined;
  /** Environment for version lookups. Defaults to process.env. */
  env?: NodeJS.ProcessEnv | undefined;
  /** Test seam: replaces child-process execution. */
  runner?: CommandRunner | undefined;
  /** Test seam: replaces the Appium HTTP probe. */
  httpProbe?: HttpProbe | undefined;
  /** Test seam: fixed clock. */
  now?: (() => Date) | undefined;
}
