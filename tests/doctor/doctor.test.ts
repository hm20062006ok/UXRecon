import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatDoctorReport, runDoctor, type CommandRunner, type HttpProbe } from "../../src/doctor/index.js";

const VALID_CONFIG = `
device:
  udid: "00008110-001544EC36A1801E"
  platformVersion: "27.0"
app:
  bundleId: com.global.wallet.ios
appium:
  xcodeOrgId: U52SAV7FXF
  updatedWDABundleId: com.miaohu.uxrecon.WebDriverAgentRunner
`;

describe("runDoctor", () => {
  it("generates a successful report when all tools and prerequisites are satisfied", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "uxr-doctor-test-"));
    const configPath = path.join(tempDir, "config.yaml");
    writeFileSync(configPath, VALID_CONFIG, "utf8");

    const mockRunner: CommandRunner = (command, args) => {
      if (command === "xcode-select")
        return Promise.resolve({ code: 0, stdout: "/Applications/Xcode.app", stderr: "" });
      if (command === "xcodebuild")
        return Promise.resolve({ code: 0, stdout: "Xcode 27.1\nBuild 27A9275", stderr: "" });
      if (command === "xcrun" && args[1] === "list") {
        return Promise.resolve({
          code: 0,
          stdout: "00008110-001544EC36A1801E iPhone 15 Pro (connected)",
          stderr: "",
        });
      }
      if (command.includes("appium") && args[0] === "--version") {
        return Promise.resolve({ code: 0, stdout: "3.8.0", stderr: "" });
      }
      if (command.includes("appium") && args[0] === "driver") {
        return Promise.resolve({ code: 0, stdout: "xcuitest@12.19.1 [installed]", stderr: "" });
      }
      if (command === "codex") {
        return Promise.resolve({ code: 0, stdout: "codex-cli 0.4.0", stderr: "" });
      }
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };

    const mockProbe: HttpProbe = () => {
      return Promise.resolve({ ok: true, status: 200, body: '{"value":{"ready":true}}' });
    };

    try {
      const report = await runDoctor({
        configPath,
        runner: mockRunner,
        httpProbe: mockProbe,
        now: () => new Date("2026-10-20T12:00:00Z"),
      });

      expect(report.schemaVersion).toBe(1);
      expect(report.generatedAt).toBe("2026-10-20T12:00:00.000Z");
      expect(report.summary.fail).toBe(0);
      expect(report.summary.ok).toBe(true);

      const checkIds = report.checks.map((c) => c.id);
      expect(checkIds).toContain("config.loaded");
      expect(checkIds).toContain("xcode.installed");
      expect(checkIds).toContain("node.version");
      expect(checkIds).toContain("device.connected");
      expect(checkIds).toContain("appium.installed");
      expect(checkIds).toContain("appium.driver");
      expect(checkIds).toContain("appium.running");
      expect(checkIds).toContain("wda.ready");
      expect(checkIds).toContain("agent.cli");

      const configCheck = report.checks.find((c) => c.id === "config.loaded");
      expect(configCheck?.status).toBe("pass");

      const wdaCheck = report.checks.find((c) => c.id === "wda.ready");
      expect(wdaCheck?.status).toBe("pass");

      const agentCheck = report.checks.find((c) => c.id === "agent.cli");
      expect(agentCheck?.status).toBe("pass");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("warns when no configuration file is present and skips WDA check", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "uxr-doctor-empty-"));
    const mockRunner: CommandRunner = () => Promise.resolve({ code: 0, stdout: "ok", stderr: "" });
    const mockProbe: HttpProbe = () => Promise.resolve({ ok: true, status: 200, body: "" });

    try {
      const report = await runDoctor({
        cwd: tempDir,
        runner: mockRunner,
        httpProbe: mockProbe,
      });

      const configCheck = report.checks.find((c) => c.id === "config.loaded");
      expect(configCheck?.status).toBe("warn");
      expect(configCheck?.hint).toContain("config.example.yaml");

      const wdaCheck = report.checks.find((c) => c.id === "wda.ready");
      expect(wdaCheck?.status).toBe("skip");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails when an explicitly specified config file does not exist", async () => {
    const mockRunner: CommandRunner = () => Promise.resolve({ code: 0, stdout: "ok", stderr: "" });
    const report = await runDoctor({
      configPath: "/non/existent/path/to/config.yaml",
      runner: mockRunner,
      httpProbe: () => Promise.resolve({ ok: true, status: 200, body: "" }),
    });

    const configCheck = report.checks.find((c) => c.id === "config.loaded");
    expect(configCheck?.status).toBe("fail");
    expect(report.summary.ok).toBe(false);
  });

  it("reports failure and hints when Xcode or Command Line Tools are missing", async () => {
    const mockRunner: CommandRunner = (command) => {
      if (command === "xcode-select") {
        return Promise.resolve({
          code: 1,
          stdout: "",
          stderr: "xcode-select: error: unable to get developer directory",
        });
      }
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };

    const report = await runDoctor({
      runner: mockRunner,
      httpProbe: () => Promise.resolve({ ok: false, status: 0, body: "" }),
    });

    const xcodeCheck = report.checks.find((c) => c.id === "xcode.installed");
    expect(xcodeCheck?.status).toBe("fail");
    expect(xcodeCheck?.hint).toContain("xcode-select --install");
    expect(report.summary.ok).toBe(false);
  });

  it("reports warning when Appium is not actively running", async () => {
    const mockRunner: CommandRunner = () => Promise.resolve({ code: 0, stdout: "1.0.0", stderr: "" });
    const mockProbe: HttpProbe = () => Promise.resolve({ ok: false, status: 0, body: "ECONNREFUSED" });

    const report = await runDoctor({
      runner: mockRunner,
      httpProbe: mockProbe,
    });

    const appiumRunningCheck = report.checks.find((c) => c.id === "appium.running");
    expect(appiumRunningCheck?.status).toBe("warn");
    expect(appiumRunningCheck?.hint).toContain("p0:appium");
  });

  it("reports warning when configured AI Agent CLI is not in PATH", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "uxr-doctor-agent-warn-"));
    const configPath = path.join(tempDir, "config.yaml");
    writeFileSync(configPath, `${VALID_CONFIG}\nagent:\n  provider: codex\n`, "utf8");

    const mockRunner: CommandRunner = (command) => {
      if (command === "codex")
        return Promise.resolve({ code: 127, stdout: "", stderr: "command not found: codex" });
      return Promise.resolve({ code: 0, stdout: "xcuitest", stderr: "" });
    };

    const report = await runDoctor({
      configPath,
      runner: mockRunner,
      httpProbe: () => Promise.resolve({ ok: true, status: 200, body: "" }),
    });

    const agentCheck = report.checks.find((c) => c.id === "agent.cli");
    expect(agentCheck?.status).toBe("warn");
    expect(agentCheck?.hint).toContain("codex");
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("passes immediately without checking external binary when agent.provider is none", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "uxr-doctor-agent-none-"));
    const configPath = path.join(tempDir, "config.yaml");
    writeFileSync(configPath, `${VALID_CONFIG}\nagent:\n  provider: none\n`, "utf8");

    const commandsRun: string[] = [];
    const mockRunner: CommandRunner = (command) => {
      commandsRun.push(command);
      return Promise.resolve({ code: 0, stdout: "ok", stderr: "" });
    };

    try {
      const report = await runDoctor({
        configPath,
        runner: mockRunner,
        httpProbe: () => Promise.resolve({ ok: true, status: 200, body: "" }),
      });

      const agentCheck = report.checks.find((c) => c.id === "agent.cli");
      expect(agentCheck?.status).toBe("pass");
      expect(agentCheck?.detail).toContain("Deterministic rule-based planner");
      expect(commandsRun).not.toContain("codex");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("formatDoctorReport", () => {
  it("formats passes, warnings, and failures with status tags and summary", () => {
    const output = formatDoctorReport({
      schemaVersion: 1,
      generatedAt: "2026-10-20T12:00:00Z",
      checks: [
        {
          id: "test.pass",
          title: "Test Pass",
          status: "pass",
          detail: "Everything looks good",
          durationMs: 5,
        },
        {
          id: "test.fail",
          title: "Test Fail",
          status: "fail",
          detail: "Something broke",
          hint: "Run fix-command",
          durationMs: 12,
        },
      ],
      summary: {
        pass: 1,
        warn: 0,
        fail: 1,
        skip: 0,
        ok: false,
      },
    });

    expect(output).toContain("[PASS] ✔ Test Pass");
    expect(output).toContain("[FAIL] ✖ Test Fail");
    expect(output).toContain("Fix: Run fix-command");
    expect(output).toContain("Summary: 1 passed, 0 warnings, 1 failed, 0 skipped");
    expect(output).toContain("Some critical checks failed");
  });
});
