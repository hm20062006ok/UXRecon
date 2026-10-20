import path from "node:path";
import type {
  CheckStatus,
  CommandRunner,
  DoctorCheck,
  DoctorContext,
  DoctorOptions,
  HttpProbe,
} from "./types.js";

async function measure<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  const result = await fn();
  const durationMs = Date.now() - start;
  return { result, durationMs };
}

export function checkConfig(context: DoctorContext): DoctorCheck {
  const start = Date.now();
  if (context.config !== null) {
    const configPath = context.configPath ?? "in-memory config";
    return {
      id: "config.loaded",
      title: "Configuration",
      status: "pass",
      detail: `Loaded valid configuration from ${configPath}`,
      durationMs: Date.now() - start,
    };
  }

  if (context.configError !== null) {
    return {
      id: "config.loaded",
      title: "Configuration",
      status: "fail",
      detail: context.configError.message,
      hint: context.configError.hint,
      durationMs: Date.now() - start,
    };
  }

  return {
    id: "config.loaded",
    title: "Configuration",
    status: "warn",
    detail: "No configuration file found in current directory",
    hint: "Copy config.example.yaml to config.yaml and configure your target iPhone and app.",
    durationMs: Date.now() - start,
  };
}

export async function checkXcode(runner: CommandRunner): Promise<DoctorCheck> {
  const { result, durationMs } = await measure(async () => {
    const select = await runner("xcode-select", ["-p"]);
    if (select.code !== 0 || !select.stdout) {
      return {
        status: "fail" as CheckStatus,
        detail: select.stderr || "xcode-select returned non-zero exit code",
        hint: "Install Command Line Tools with `xcode-select --install`.",
      };
    }

    const version = await runner("xcodebuild", ["-version"]);
    if (version.code !== 0 || !version.stdout) {
      return {
        status: "fail" as CheckStatus,
        detail: `Developer directory: ${select.stdout}. xcodebuild failed: ${version.stderr}`,
        hint: "Select a full Xcode installation with `sudo xcode-select -s /Applications/Xcode.app`.",
      };
    }

    const firstLine = version.stdout.split("\n")[0] ?? version.stdout;
    return {
      status: "pass" as CheckStatus,
      detail: `${firstLine} at ${select.stdout}`,
    };
  });

  return {
    id: "xcode.installed",
    title: "Xcode & Command Line Tools",
    status: result.status,
    detail: result.detail,
    ...(result.hint ? { hint: result.hint } : {}),
    durationMs,
  };
}

export function checkNodeVersion(): DoctorCheck {
  const start = Date.now();
  const currentVersion = process.version; // e.g. "v22.5.0"
  const majorMatch = /^v(\d+)/.exec(currentVersion);
  const major = majorMatch ? Number(majorMatch[1]) : 0;

  if (major >= 22) {
    return {
      id: "node.version",
      title: "Node.js Runtime",
      status: "pass",
      detail: `Node.js ${currentVersion} (meets requirement >= 22)`,
      durationMs: Date.now() - start,
    };
  }

  return {
    id: "node.version",
    title: "Node.js Runtime",
    status: "fail",
    detail: `Node.js ${currentVersion} is below required >= 22`,
    hint: "Upgrade Node.js to >= 22 using your version manager (nvm, fnm, or volta).",
    durationMs: Date.now() - start,
  };
}

export async function checkConnectedDevices(
  context: DoctorContext,
  runner: CommandRunner,
): Promise<DoctorCheck> {
  const { result, durationMs } = await measure(async () => {
    const devicectl = await runner("xcrun", ["devicectl", "list", "devices"]);
    const output = `${devicectl.stdout}\n${devicectl.stderr}`.trim();

    if (devicectl.code !== 0) {
      return {
        status: "fail" as CheckStatus,
        detail: devicectl.stderr || "xcrun devicectl failed",
        hint: "Ensure Xcode command line tools and devicectl are properly installed.",
      };
    }

    const targetUdid = context.config?.device.udid;
    if (targetUdid) {
      if (output.includes(targetUdid)) {
        return {
          status: "pass" as CheckStatus,
          detail: `Found target device with UDID ${targetUdid}`,
        };
      }
      return {
        status: "fail" as CheckStatus,
        detail: `Target device with UDID ${targetUdid} not found in connected devices`,
        hint: "Connect the iPhone via USB, unlock it, trust this Mac, and verify UDID in `xcrun devicectl list devices`.",
      };
    }

    // No target UDID configured; check if any device is listed
    const lines = output
      .split("\n")
      .filter((line) => line.trim().length > 0 && !line.includes("Identifier") && !line.includes("---"));
    if (lines.length > 0) {
      return {
        status: "pass" as CheckStatus,
        detail: `Detected ${lines.length} device entry/entries via devicectl`,
      };
    }

    return {
      status: "warn" as CheckStatus,
      detail: "No connected devices found via devicectl",
      hint: "Connect your test iPhone via USB, unlock the screen, and pair it with this Mac.",
    };
  });

  return {
    id: "device.connected",
    title: "iOS Device Connection",
    status: result.status,
    detail: result.detail,
    ...(result.hint ? { hint: result.hint } : {}),
    durationMs,
  };
}

export async function checkAppiumInstalled(
  runner: CommandRunner,
  options: DoctorOptions,
): Promise<DoctorCheck> {
  const { result, durationMs } = await measure(async () => {
    const cwd = options.cwd ?? process.cwd();
    const localBin = path.join(cwd, "node_modules", ".bin", "appium");

    // Try local node_modules first, then fallback to PATH
    let appiumRes = await runner(localBin, ["--version"], { timeoutMs: options.timeoutMs, env: options.env });
    if (appiumRes.code !== 0) {
      appiumRes = await runner("appium", ["--version"], { timeoutMs: options.timeoutMs, env: options.env });
    }

    if (appiumRes.code === 0 && appiumRes.stdout) {
      return {
        status: "pass" as CheckStatus,
        detail: `Appium CLI ${appiumRes.stdout}`,
      };
    }

    return {
      status: "fail" as CheckStatus,
      detail: appiumRes.stderr || "Appium CLI binary not found or failed to execute",
      hint: "Run `npm install` in the project root to install Appium locally.",
    };
  });

  return {
    id: "appium.installed",
    title: "Appium Server CLI",
    status: result.status,
    detail: result.detail,
    ...(result.hint ? { hint: result.hint } : {}),
    durationMs,
  };
}

export async function checkAppiumDriver(runner: CommandRunner, options: DoctorOptions): Promise<DoctorCheck> {
  const { result, durationMs } = await measure(async () => {
    const cwd = options.cwd ?? process.cwd();
    const localBin = path.join(cwd, "node_modules", ".bin", "appium");
    const appiumHome = path.join(cwd, ".appium");
    const env = { ...process.env, ...options.env, APPIUM_HOME: appiumHome };

    let driverRes = await runner(localBin, ["driver", "list", "--installed"], {
      timeoutMs: options.timeoutMs,
      env,
    });
    if (driverRes.code !== 0) {
      driverRes = await runner("appium", ["driver", "list", "--installed"], {
        timeoutMs: options.timeoutMs,
        env,
      });
    }

    const output = `${driverRes.stdout}\n${driverRes.stderr}`;
    if (driverRes.code === 0 && output.toLowerCase().includes("xcuitest")) {
      const match = /xcuitest@([0-9.]+)/i.exec(output);
      const versionStr = match ? ` (${match[0]})` : "";
      return {
        status: "pass" as CheckStatus,
        detail: `XCUITest driver installed${versionStr}`,
      };
    }

    return {
      status: "fail" as CheckStatus,
      detail: driverRes.stderr || "XCUITest driver is not installed in Appium",
      hint: "Install the XCUITest driver with `npx appium driver install xcuitest`.",
    };
  });

  return {
    id: "appium.driver",
    title: "Appium XCUITest Driver",
    status: result.status,
    detail: result.detail,
    ...(result.hint ? { hint: result.hint } : {}),
    durationMs,
  };
}

export async function checkAppiumRunning(context: DoctorContext, probe: HttpProbe): Promise<DoctorCheck> {
  const { result, durationMs } = await measure(async () => {
    const host = context.config?.appium.host ?? "127.0.0.1";
    const port = context.config?.appium.port ?? 4723;
    const basePath = context.config?.appium.basePath ?? "/";
    const normalizedBasePath = basePath.endsWith("/") ? basePath : `${basePath}/`;
    const url = `http://${host}:${port}${normalizedBasePath}status`;

    const res = await probe(url, { timeoutMs: 3_000 });
    if (res.ok) {
      return {
        status: "pass" as CheckStatus,
        detail: `Appium server responded OK at ${url}`,
      };
    }

    return {
      status: "warn" as CheckStatus,
      detail: `Appium server not responding at ${url} (${res.body || "connection failed"})`,
      hint: "Start Appium server with `npm run p0:appium` before beginning exploration runs.",
    };
  });

  return {
    id: "appium.running",
    title: "Appium Server Availability",
    status: result.status,
    detail: result.detail,
    ...(result.hint ? { hint: result.hint } : {}),
    durationMs,
  };
}

export async function checkWdaPrerequisites(context: DoctorContext, probe: HttpProbe): Promise<DoctorCheck> {
  const { result, durationMs } = await measure(async () => {
    const config = context.config;
    if (!config) {
      return {
        status: "skip" as CheckStatus,
        detail: "Skipped: Configuration not loaded",
      };
    }

    if (config.appium.webDriverAgentUrl) {
      const wdaUrl = config.appium.webDriverAgentUrl;
      const statusUrl = wdaUrl.endsWith("/") ? `${wdaUrl}status` : `${wdaUrl}/status`;
      const res = await probe(statusUrl, { timeoutMs: 3_000 });
      if (res.ok) {
        return {
          status: "pass" as CheckStatus,
          detail: `Standalone WebDriverAgent responded OK at ${statusUrl}`,
        };
      }
      return {
        status: "warn" as CheckStatus,
        detail: `Standalone WebDriverAgent configured at ${statusUrl} did not respond`,
        hint: "Verify WebDriverAgent is actively running on the iPhone or reachable over the network.",
      };
    }

    // Xcode auto-signing setup
    const hasOrgId = Boolean(config.appium.xcodeOrgId);
    const hasWdaBundleId = Boolean(config.appium.updatedWDABundleId);

    if (hasOrgId && hasWdaBundleId) {
      return {
        status: "pass" as CheckStatus,
        detail: `WDA signing configured (OrgId: ${config.appium.xcodeOrgId}, BundleId: ${config.appium.updatedWDABundleId})`,
      };
    }

    return {
      status: "fail" as CheckStatus,
      detail: "Missing WDA code signing details (xcodeOrgId or updatedWDABundleId)",
      hint: "Configure appium.xcodeOrgId and appium.updatedWDABundleId in config.yaml to allow Xcode to sign and deploy WDA.",
    };
  });

  return {
    id: "wda.ready",
    title: "WebDriverAgent Setup",
    status: result.status,
    detail: result.detail,
    ...(result.hint ? { hint: result.hint } : {}),
    durationMs,
  };
}

export async function checkAgentCli(
  context: DoctorContext,
  runner: CommandRunner,
  options: DoctorOptions,
): Promise<DoctorCheck> {
  const provider = context.config?.agent.provider ?? "codex";
  const command = context.config?.agent.command ?? (provider === "none" ? "" : provider);

  if (provider === "none") {
    return {
      id: "agent.cli",
      title: "AI Agent Planner",
      status: "pass",
      detail: "Deterministic rule-based planner selected (no external AI agent required)",
      durationMs: 0,
    };
  }

  const { result, durationMs } = await measure(async () => {
    const res = await runner(command, ["--version"], { timeoutMs: options.timeoutMs, env: options.env });
    if (res.code === 0 && res.stdout) {
      return {
        status: "pass" as CheckStatus,
        detail: `${provider.toUpperCase()} CLI available: ${res.stdout} (command: ${command})`,
      };
    }

    return {
      status: "warn" as CheckStatus,
      detail: res.stderr || `Agent CLI command \`${command}\` (${provider}) not found in PATH`,
      hint: `Install the CLI for ${provider} or configure agent.command in config.yaml, or set agent.provider: none to use the deterministic fallback planner.`,
    };
  });

  return {
    id: "agent.cli",
    title: `AI Agent CLI (${provider})`,
    status: result.status,
    detail: result.detail,
    ...(result.hint ? { hint: result.hint } : {}),
    durationMs,
  };
}

/** Backward-compatible alias for checking default Codex CLI directly. */
export async function checkCodexCli(runner: CommandRunner, options: DoctorOptions): Promise<DoctorCheck> {
  const check = await checkAgentCli(
    {
      config: null,
      configError: null,
      configPath: null,
      logger: {
        phase: "doctor",
        debug() {},
        info() {},
        warn() {},
        error() {},
        child() {
          return this;
        },
      },
    },
    runner,
    options,
  );
  return {
    ...check,
    id: "codex.cli",
    title: "Codex CLI",
  };
}
