import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadConfig,
  parseConfig,
  resolveConfigPath,
  substituteEnv,
  toSafeSnapshot,
  type Config,
} from "../../src/config/index.js";
import { isAppError, type AppError } from "../../src/errors/index.js";

const VALID = `
device:
  udid: "00008110-001544EC36A1801E"
  platformVersion: "27.0"
app:
  bundleId: com.global.wallet.ios
appium:
  xcodeOrgId: U52SAV7FXF
  updatedWDABundleId: com.miaohu.uxrecon.WebDriverAgentRunner
`;

const FULL_UDID = "00008110-001544EC36A1801E";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "uxr-config-"));
  tempDirs.push(directory);
  return directory;
}

function expectAppError(run: () => unknown, code: AppError["code"]): AppError {
  try {
    run();
  } catch (error) {
    expect(isAppError(error)).toBe(true);
    const appError = error as AppError;
    expect(appError.code).toBe(code);
    return appError;
  }
  throw new Error(`Expected AppError ${code} but nothing was thrown`);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

describe("parseConfig", () => {
  it("applies defaults to a minimal file", () => {
    const config = parseConfig(VALID, "test.yaml", {});
    expect(config.schemaVersion).toBe(1);
    expect(config.device.name).toBe("iPhone");
    expect(config.appium.host).toBe("127.0.0.1");
    expect(config.appium.port).toBe(4723);
    expect(config.appium.basePath).toBe("/");
    expect(config.appium.webDriverAgentUrl).toBeNull();
    expect(config.appium.xcodeSigningId).toBe("Apple Development");
    expect(config.appium.allowProvisioningDeviceRegistration).toBe(false);
    expect(config.safety.allowSafeTap).toBe(true);
    expect(config.safety.denyKeywords).toEqual([]);
    expect(config.safety.confirmKeywords).toEqual([]);
    expect(config.exploration.dryRun).toBe(true);
    expect(config.exploration.maxDepth).toBe(6);
    expect(config.agent.provider).toBe("codex");
    expect(config.agent.command).toBe("codex");
    expect(config.agent.model).toBeNull();
    expect(config.agent.args).toEqual([]);
    expect(config.agent.timeoutMs).toBe(60_000);
    expect(config.run.outputDir).toBe("runs");
    expect(config.logging).toEqual({ level: "info", jsonl: true });
  });

  it("supports configurable AI agent provider and custom command", () => {
    const yaml = `
${VALID}
agent:
  provider: claude
  command: /usr/local/bin/claude
  model: claude-3-7-sonnet
  args: ["--print"]
  timeoutMs: 45000
`;
    const config = parseConfig(yaml, "agent-test.yaml", {});
    expect(config.agent.provider).toBe("claude");
    expect(config.agent.command).toBe("/usr/local/bin/claude");
    expect(config.agent.model).toBe("claude-3-7-sonnet");
    expect(config.agent.args).toEqual(["--print"]);
    expect(config.agent.timeoutMs).toBe(45_000);
  });

  it("reports a missing device UDID as an actionable error", () => {
    const error = expectAppError(
      () => parseConfig('device:\n  platformVersion: "27.0"\napp:\n  bundleId: a.b\n', "t.yaml", {}),
      "UXR-CFG-003",
    );
    expect(error.message).toContain("device.udid");
    expect(error.message).toContain("xcrun devicectl list devices");
    expect(error.exitCode).toBe(2);
  });

  it("reports a missing bundle id as an actionable error", () => {
    const error = expectAppError(
      () => parseConfig('device:\n  udid: abc\n  platformVersion: "27.0"\napp: {}\n', "t.yaml", {}),
      "UXR-CFG-003",
    );
    expect(error.message).toContain("app.bundleId");
    expect(error.message).toContain("com.global.wallet.ios");
  });

  it("rejects unknown keys so typos do not silently fall back to defaults", () => {
    const error = expectAppError(
      () => parseConfig(`${VALID}\nbundleID: com.typo\n`, "t.yaml", {}),
      "UXR-CFG-003",
    );
    expect(error.message.toLowerCase()).toContain("unrecognized");
  });

  it("rejects an unsupported schema version", () => {
    const error = expectAppError(
      () => parseConfig(`${VALID}\nschemaVersion: 99\n`, "t.yaml", {}),
      "UXR-CFG-005",
    );
    expect(error.message).toContain("99");
  });

  it("reports malformed YAML without leaking the parser stack", () => {
    const error = expectAppError(() => parseConfig("device: [unclosed\n", "t.yaml", {}), "UXR-CFG-002");
    expect(error.message).toContain("t.yaml");
    expect(error.exitCode).toBe(2);
  });

  it("substitutes ${VAR} from the environment", () => {
    const config = parseConfig(
      'device:\n  udid: ${TEST_UDID}\n  platformVersion: "27.0"\napp:\n  bundleId: a.b\nappium:\n  xcodeOrgId: T\n  updatedWDABundleId: b\n',
      "t.yaml",
      { TEST_UDID: FULL_UDID },
    );
    expect(config.device.udid).toBe(FULL_UDID);
  });

  it("substitutes ${VAR:-fallback} and keeps numeric fields numeric", () => {
    const config = parseConfig(`${VALID.replace("port: 4723", "")}`, "t.yaml", {});
    expect(config.appium.port).toBe(4723);

    const withFallback = parseConfig(
      `device:\n  udid: x\n  platformVersion: "27.0"\napp:\n  bundleId: a.b\nappium:\n  port: \${MISSING_PORT:-4724}\n  xcodeOrgId: T\n  updatedWDABundleId: b\n`,
      "t.yaml",
      {},
    );
    expect(withFallback.appium.port).toBe(4724);
  });

  it("names every missing environment variable in one error", () => {
    const error = expectAppError(
      () =>
        parseConfig("device:\n  udid: ${A}\n  platformVersion: ${B}\napp:\n  bundleId: a.b\n", "t.yaml", {}),
      "UXR-CFG-004",
    );
    expect(error.message).toContain("A");
    expect(error.message).toContain("B");
  });

  it("keeps $${VAR} literal", () => {
    expect(substituteEnv("a: $${KEEP}\n", {}, "t.yaml")).toBe("a: ${KEEP}\n");
  });

  it("quotes substituted values that would otherwise break YAML", () => {
    const config = parseConfig(
      'device:\n  udid: ${TEST_NAME}\n  platformVersion: "27.0"\napp:\n  bundleId: a.b\nappium:\n  xcodeOrgId: T\n  updatedWDABundleId: b\n',
      "t.yaml",
      { TEST_NAME: "iPhone: test #1" },
    );
    expect(config.device.udid).toBe("iPhone: test #1");
  });

  it("lets a webDriverAgentUrl replace the signing requirements", () => {
    const config = parseConfig(
      `device:\n  udid: x\n  platformVersion: "27.0"\napp:\n  bundleId: a.b\nappium:\n  webDriverAgentUrl: http://127.0.0.1:8100\n`,
      "t.yaml",
      {},
    );
    expect(config.appium.webDriverAgentUrl).toBe("http://127.0.0.1:8100");
    expect(config.appium.xcodeOrgId).toBe("");
  });

  it("requires signing fields when no WDA url is given", () => {
    const error = expectAppError(
      () =>
        parseConfig('device:\n  udid: x\n  platformVersion: "27.0"\napp:\n  bundleId: a.b\n', "t.yaml", {}),
      "UXR-CFG-003",
    );
    expect(error.message).toContain("appium.xcodeOrgId");
    expect(error.message).toContain("appium.updatedWDABundleId");
  });

  it("rejects out-of-range numbers with the allowed range", () => {
    const rangeError = expectAppError(
      () => parseConfig(VALID.replace("appium:\n", "appium:\n  port: 70000\n"), "t.yaml", {}),
      "UXR-CFG-003",
    );
    expect(rangeError.message).toContain("appium.port");
  });

  it("rejects an invalid redactPatterns regex", () => {
    const error = expectAppError(
      () => parseConfig(`${VALID}\nsafety:\n  redactPatterns:\n    - "[unclosed"\n`, "t.yaml", {}),
      "UXR-CFG-003",
    );
    expect(error.message).toContain("redactPatterns");
  });
});

describe("toSafeSnapshot", () => {
  it("masks the device UDID and keeps everything else", () => {
    const config = parseConfig(VALID, "t.yaml", {});
    const snapshot = toSafeSnapshot(config);
    const serialised = JSON.stringify(snapshot);

    expect(serialised).not.toContain(FULL_UDID);
    expect((snapshot["device"] as Record<string, unknown>)["udid"]).toBe("00008110…A1801E");
    expect((snapshot["app"] as Record<string, unknown>)["bundleId"]).toBe("com.global.wallet.ios");
    expect((snapshot["exploration"] as Record<string, unknown>)["dryRun"]).toBe(true);
  });

  it("stays JSON-serialisable", () => {
    const config = parseConfig(VALID, "t.yaml", {});
    expect(() => JSON.stringify(toSafeSnapshot(config))).not.toThrow();
  });
});

describe("loadConfig", () => {
  it("discovers a config file in the working directory", () => {
    const directory = makeTempDir();
    writeFileSync(path.join(directory, "uxr.config.yaml"), VALID, "utf8");
    const config: Config = loadConfig({ cwd: directory, env: {} });
    expect(config.app.bundleId).toBe("com.global.wallet.ios");
  });

  it("fails with the searched filenames when nothing is found", () => {
    const directory = makeTempDir();
    const error = expectAppError(() => loadConfig({ cwd: directory, env: {} }), "UXR-CFG-001");
    expect(error.message).toContain("uxr.config.yaml");
  });

  it("fails when an explicit path does not exist", () => {
    const directory = makeTempDir();
    const error = expectAppError(
      () => loadConfig({ cwd: directory, configPath: "nope.yaml", env: {} }),
      "UXR-CFG-001",
    );
    expect(error.message).toContain("nope.yaml");
  });

  it("prefers an explicit path over discovery", () => {
    const directory = makeTempDir();
    writeFileSync(path.join(directory, "uxr.config.yaml"), VALID, "utf8");
    writeFileSync(
      path.join(directory, "other.yaml"),
      VALID.replace("com.global.wallet.ios", "com.other.app"),
      "utf8",
    );
    const resolved = resolveConfigPath({ cwd: directory, configPath: "other.yaml" });
    expect(resolved.explicit).toBe(true);
    expect(loadConfig({ cwd: directory, configPath: "other.yaml", env: {} }).app.bundleId).toBe(
      "com.other.app",
    );
  });
});

describe("config.example.yaml", () => {
  it("parses with the documented environment variables", () => {
    const examplePath = path.join(import.meta.dirname, "..", "..", "config.example.yaml");
    const config = loadConfig({
      configPath: examplePath,
      env: {
        UXR_DEVICE_UDID: FULL_UDID,
        UXR_PLATFORM_VERSION: "27.0",
        UXR_XCODE_ORG_ID: "U52SAV7FXF",
        UXR_WDA_BUNDLE_ID: "com.miaohu.uxrecon.WebDriverAgentRunner",
      },
    });
    expect(config.device.udid).toBe(FULL_UDID);
    expect(config.app.bundleId).toBe("com.global.wallet.ios");
    expect(config.appium.xcodeOrgId).toBe("U52SAV7FXF");
    expect(config.safety.allowSafeTap).toBe(true);
    expect(config.safety.denyKeywords).toEqual([]);
  });
});
