import { loadConfig, resolveConfigPath, type Config } from "../config/index.js";
import { toAppError, type AppError } from "../errors/index.js";
import { createSilentLogger } from "../logging/index.js";
import {
  checkAppiumDriver,
  checkAppiumInstalled,
  checkAppiumRunning,
  checkAgentCli,
  checkConfig,
  checkConnectedDevices,
  checkNodeVersion,
  checkWdaPrerequisites,
  checkXcode,
} from "./checks.js";
import { defaultCommandRunner, defaultHttpProbe } from "./runner.js";
import type { DoctorCheck, DoctorContext, DoctorOptions, DoctorReport } from "./types.js";

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const runner = options.runner ?? defaultCommandRunner;
  const probe = options.httpProbe ?? defaultHttpProbe;
  const now = options.now ?? (() => new Date());

  let config: Config | null = null;
  let configError: AppError | null = null;
  let configPath: string | null = null;

  try {
    const resolved = resolveConfigPath({
      configPath: options.configPath,
      cwd: options.cwd,
      env: options.env,
    });
    configPath = resolved.path;
    config = loadConfig({
      configPath: options.configPath,
      cwd: options.cwd,
      env: options.env,
    });
  } catch (error: unknown) {
    const appError = toAppError(error);
    if (appError.code === "UXR-CFG-001" && !options.configPath) {
      // Default config not found in current directory; warn rather than fail
      config = null;
      configPath = null;
      configError = null;
    } else {
      configError = appError;
    }
  }

  const context: DoctorContext = {
    config,
    configError,
    configPath,
    logger: createSilentLogger(),
  };

  const checks: DoctorCheck[] = [
    checkConfig(context),
    await checkXcode(runner),
    checkNodeVersion(),
    await checkConnectedDevices(context, runner),
    await checkAppiumInstalled(runner, options),
    await checkAppiumDriver(runner, options),
    await checkAppiumRunning(context, probe),
    await checkWdaPrerequisites(context, probe),
    await checkAgentCli(context, runner, options),
  ];

  let pass = 0;
  let warn = 0;
  let fail = 0;
  let skip = 0;

  for (const check of checks) {
    if (check.status === "pass") pass += 1;
    else if (check.status === "warn") warn += 1;
    else if (check.status === "fail") fail += 1;
    else if (check.status === "skip") skip += 1;
  }

  return {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    checks,
    summary: {
      pass,
      warn,
      fail,
      skip,
      ok: fail === 0,
    },
  };
}

export { formatDoctorReport } from "./format.js";
export * from "./types.js";
