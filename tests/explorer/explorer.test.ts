import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig, type Config } from "../../src/config/index.js";
import { RecursiveExplorer } from "../../src/explorer/index.js";
import { createSilentLogger } from "../../src/logging/index.js";

const VALID_CONFIG = `
device:
  udid: "00008110-001544EC36A1801E"
  platformVersion: "27.0"
app:
  bundleId: com.global.wallet.ios
appium:
  xcodeOrgId: U52SAV7FXF
  updatedWDABundleId: com.miaohu.uxrecon.WebDriverAgentRunner
exploration:
  maxPages: 3
  maxActions: 5
  maxDepth: 3
agent:
  provider: none
`;

const FAKE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Wallet" label="Wallet" visible="true" x="0" y="0" width="393" height="852">
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="btn_market" label="Market" visible="true" enabled="true" x="20" y="800" width="80" height="40" />
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="btn_settings" label="Settings" visible="true" enabled="true" x="300" y="800" width="80" height="40" />
  </XCUIElementTypeApplication>
</AppiumAUT>`;

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "uxr-explorer-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeMockDevice() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isHealthy: vi.fn().mockResolvedValue(true),
    takeScreenshot: vi
      .fn()
      .mockResolvedValue(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      ),
    getPageSource: vi.fn().mockResolvedValue(FAKE_XML),
    getViewport: vi.fn().mockResolvedValue({ width: 393, height: 852 }),
    getOrientation: vi.fn().mockResolvedValue("PORTRAIT"),
    getActiveApp: vi.fn().mockResolvedValue({ bundleId: "com.global.wallet.ios" }),
    tap: vi.fn().mockResolvedValue({ success: true, durationMs: 100 }),
    typeText: vi.fn().mockResolvedValue({ success: true, durationMs: 100 }),
    clearText: vi.fn().mockResolvedValue({ success: true, durationMs: 50 }),
    scroll: vi.fn().mockResolvedValue({ success: true, durationMs: 200 }),
    back: vi.fn().mockResolvedValue({ success: true, durationMs: 150 }),
    dismissKeyboard: vi.fn().mockResolvedValue(true),
    handleAlert: vi.fn().mockResolvedValue(true),
    restartApp: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe("RecursiveExplorer", () => {
  it("executes bounded exploration, records observations, and gracefully exits", async () => {
    const tempDir = makeTempDir();
    const config: Config = parseConfig(VALID_CONFIG, "test.yaml", {});
    config.run.outputDir = tempDir;

    const mockDevice = makeMockDevice();
    const explorer = new RecursiveExplorer(config, mockDevice, createSilentLogger(), {
      maxPages: 2,
      maxActions: 2,
    });

    const result = await explorer.run();

    expect(result.status).toBe("completed");
    expect(mockDevice.connect).toHaveBeenCalled();
    expect(mockDevice.disconnect).toHaveBeenCalled();
    expect(result.summary.screenshotCount).toBeGreaterThanOrEqual(1);
    expect(result.summary.transitionCount).toBeGreaterThanOrEqual(1);
  });
});
