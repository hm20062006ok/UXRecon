import process from "node:process";
import { loadConfig } from "../config/index.js";
import { createDeviceAdapter } from "../device/index.js";
import { formatDoctorReport, runDoctor } from "../doctor/index.js";
import { AppError, describeError, toAppError } from "../errors/index.js";
import { RecursiveExplorer } from "../explorer/index.js";
import { createLogger } from "../logging/index.js";

interface CliArgs {
  command?: string | undefined;
  configPath?: string | undefined;
  json: boolean;
  verbose: boolean;
  help: boolean;
  dryRun?: boolean | undefined;
  maxPages?: number | undefined;
  maxActions?: number | undefined;
  maxDepth?: number | undefined;
  startAction?: string | undefined;
}

function parseCliArgs(args: string[]): CliArgs {
  let command: string | undefined;
  let configPath: string | undefined;
  let json = false;
  let verbose = false;
  let help = false;
  let dryRun: boolean | undefined;
  let maxPages: number | undefined;
  let maxActions: number | undefined;
  let maxDepth: number | undefined;
  let startAction: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h" || arg === "help") {
      help = true;
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--max-pages") {
      i += 1;
      maxPages = Number(args[i]);
    } else if (arg === "--max-actions") {
      i += 1;
      maxActions = Number(args[i]);
    } else if (arg === "--max-depth") {
      i += 1;
      maxDepth = Number(args[i]);
    } else if (arg === "--start-action" || arg === "--initial-tap") {
      i += 1;
      if (i < args.length) {
        startAction = args[i];
      } else {
        throw new AppError("UXR-CLI-002", `Option ${arg} requires a target element label argument.`);
      }
    } else if (arg === "--config" || arg === "-c") {
      i += 1;
      if (i < args.length) {
        configPath = args[i];
      } else {
        throw new AppError("UXR-CLI-002", "Option --config requires a path argument.");
      }
    } else if (arg.startsWith("-")) {
      throw new AppError("UXR-CLI-002", `Unrecognized flag: ${arg}`);
    } else if (!command) {
      command = arg;
    } else {
      throw new AppError("UXR-CLI-002", `Unexpected extra positional argument: ${arg}`);
    }
  }

  return {
    command,
    configPath,
    json,
    verbose,
    help,
    dryRun,
    maxPages,
    maxActions,
    maxDepth,
    startAction,
  };
}

function printHelp(): void {
  console.log(`
iPhone UX Explorer (UXRecon) CLI

Usage:
  uxr <command> [options]

Commands:
  doctor              Check macOS, Xcode, connected iPhone, Appium, WDA, and AI Agent CLI prerequisites.
  explore             Start recursive, bounded, safe exploration of the target application.

Options:
  -c, --config <path> Explicit path to configuration YAML file.
  --dry-run           Plan and record without executing device write actions.
  --start-action <t>  Initial element label to tap before starting exploration (e.g. "I already have a wallet").
  --max-pages <n>     Maximum pages to explore before stopping.
  --max-actions <n>   Maximum interactions to execute.
  --max-depth <n>     Maximum recursion depth in navigation stack.
  --json              Output structured JSON report (for doctor).
  -v, --verbose       Print verbose diagnostics and full stack traces on internal errors.
  -h, --help          Show this help message.
`);
}

async function handleDoctor(args: CliArgs): Promise<number> {
  const report = await runDoctor({
    configPath: args.configPath,
    env: process.env,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDoctorReport(report));
  }

  return report.summary.ok ? 0 : 1;
}

let activeExplorer: RecursiveExplorer | undefined;

async function handleExplore(args: CliArgs): Promise<number> {
  const config = loadConfig({ configPath: args.configPath });
  if (args.dryRun !== undefined) {
    config.exploration.dryRun = args.dryRun;
  }

  const logger = createLogger({
    level: args.verbose ? "debug" : config.logging.level,
  });

  const startActions: string[] = args.startAction
    ? args.startAction
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : (config.exploration.startActions ?? []);

  const device = createDeviceAdapter(config, logger);
  const explorer = new RecursiveExplorer(config, device, logger, {
    maxPages: args.maxPages,
    maxActions: args.maxActions,
    maxDepth: args.maxDepth,
    dryRun: config.exploration.dryRun,
    startActions,
  });

  activeExplorer = explorer;
  const result = await explorer.run();

  console.log(`\nExploration completed with status: [${result.status.toUpperCase()}]`);
  console.log(`Run ID: ${result.runId}`);
  console.log(`Reason: ${result.stopReason}`);
  console.log(`Pages recorded: ${result.summary.pageCount}`);
  console.log(`Transitions recorded: ${result.summary.transitionCount}`);
  console.log(`Screenshots captured: ${result.summary.screenshotCount}`);

  return result.status === "failed" ? 1 : 0;
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    const appError = toAppError(error, "UXR-CLI-002");
    process.stderr.write(`${describeError(appError)}\n`);
    return appError.exitCode;
  }

  if (args.help || !args.command) {
    printHelp();
    return 0;
  }

  if (args.command === "doctor") {
    return handleDoctor(args);
  }

  if (args.command === "explore") {
    try {
      return await handleExplore(args);
    } catch (error) {
      const appError = toAppError(error);
      process.stderr.write(`${describeError(appError)}\n`);
      return appError.exitCode;
    }
  }

  const error = new AppError("UXR-CLI-001", `Unknown command: ${args.command}`);
  process.stderr.write(`${describeError(error)}\n`);
  return error.exitCode;
}

// Only auto-run if directly executed
if (import.meta.url === `file://${process.argv[1]}`) {
  process.on("SIGINT", () => {
    process.stderr.write("\nInterrupted by user (SIGINT). Finalizing current run...\n");
    if (activeExplorer) {
      activeExplorer.interrupt();
    } else {
      process.exit(130);
    }
  });
  process.on("SIGTERM", () => {
    process.stderr.write("\nTerminated (SIGTERM). Finalizing current run...\n");
    if (activeExplorer) {
      activeExplorer.interrupt();
    } else {
      process.exit(143);
    }
  });

  runCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      const isVerbose = process.argv.includes("--verbose") || process.argv.includes("-v");
      const appError = toAppError(error);
      process.stderr.write(`${describeError(appError)}\n`);
      if (isVerbose && error instanceof Error && error.stack) {
        process.stderr.write(`\nStack trace:\n${error.stack}\n`);
      }
      process.exit(appError.exitCode);
    });
}
