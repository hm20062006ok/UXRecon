import { describe, expect, it, vi } from "vitest";
import type { Config } from "../../src/config/index.js";
import {
  DryRunDeviceAdapter,
  RealDeviceAdapter,
  SessionManager,
  buildCapabilities,
  buildConnectionOptions,
  candidateToWdioSelector,
  createDeviceAdapter,
  mapSessionError,
  prioritizeCandidates,
  withTimeout,
  type WdioClient,
  type WdioElement,
} from "../../src/device/index.js";
import { AppError } from "../../src/errors/index.js";
import { createSilentLogger } from "../../src/logging/index.js";
import type { LocatorCandidate, UIElement } from "../../src/types/contracts.js";

function createMockConfig(overrides: { dryRun?: boolean; webDriverAgentUrl?: string | null } = {}): Config {
  return {
    schemaVersion: 1,
    device: {
      udid: "00008110-001234567890ABCD",
      name: "iPhone 15 Pro",
      platformVersion: "18.3",
    },
    app: {
      bundleId: "com.apple.Preferences",
    },
    appium: {
      host: "127.0.0.1",
      port: 4723,
      basePath: "/",
      webDriverAgentUrl: overrides.webDriverAgentUrl ?? null,
      xcodeOrgId: "TEAMID1234",
      xcodeSigningId: "Apple Development",
      updatedWDABundleId: "com.example.wda",
      allowProvisioningDeviceRegistration: true,
      wdaLaunchTimeoutMs: 30000,
      wdaConnectionTimeoutMs: 30000,
      newCommandTimeoutSec: 120,
    },
    safety: {
      allowSafeTap: false,
      denyKeywords: ["delete", "transfer"],
      confirmKeywords: ["login", "submit"],
      redactPatterns: [],
    },
    exploration: {
      dryRun: overrides.dryRun ?? false,
      maxPages: 10,
      maxActions: 50,
      maxDepth: 5,
      actionRetryLimit: 2,
      scrollLimit: 3,
    },
    agent: {
      provider: "none",
      command: "codex",
      model: null,
      args: [],
      timeoutMs: 30000,
    },
    run: {
      outputDir: "runs",
      project: "test",
    },
    logging: {
      level: "error",
      jsonl: false,
    },
  };
}

function createDummyUIElement(candidates: LocatorCandidate[] = []): UIElement {
  return {
    elementId: "elem_01",
    semanticId: "settings.wifi",
    type: "XCUIElementTypeCell",
    label: "Wi-Fi",
    name: "Wi-Fi",
    value: "Connected",
    bounds: { x: 10, y: 100, width: 375, height: 44 },
    enabled: true,
    visible: true,
    selected: false,
    locatorCandidates: candidates,
    possibleActions: ["tap"],
    source: "accessibility",
    confidence: 0.95,
  };
}

interface MockClientOptions {
  existingSelectors?: string[];
  failingClickSelectors?: string[];
  failingSetValueSelectors?: string[];
  failingClearSelectors?: string[];
  windowSize?: { width: number; height: number };
  orientation?: string;
  screenshot?: string;
  pageSource?: string;
  activeApp?: { bundleId?: string; processId?: number; pid?: number };
  onExecute?: (script: string, ...args: unknown[]) => unknown;
  onDeleteSession?: () => Promise<void> | void;
  onStatus?: () => unknown;
}

function createMockWdioClient(options: MockClientOptions = {}): WdioClient & {
  executedScripts: Array<{ script: string; args: unknown[] }>;
  clickedSelectors: string[];
  setValues: Array<{ selector: string; value: string }>;
  clearedSelectors: string[];
  backCount: number;
  hideKeyboardCount: number;
  acceptAlertCount: number;
  dismissAlertCount: number;
  deleteSessionCount: number;
} {
  const existing = new Set(options.existingSelectors ?? []);
  const failingClicks = new Set(options.failingClickSelectors ?? []);
  const failingSetValues = new Set(options.failingSetValueSelectors ?? []);
  const failingClears = new Set(options.failingClearSelectors ?? []);

  const executedScripts: Array<{ script: string; args: unknown[] }> = [];
  const clickedSelectors: string[] = [];
  const setValues: Array<{ selector: string; value: string }> = [];
  const clearedSelectors: string[] = [];
  let backCount = 0;
  let hideKeyboardCount = 0;
  let acceptAlertCount = 0;
  let dismissAlertCount = 0;
  let deleteSessionCount = 0;

  return {
    executedScripts,
    clickedSelectors,
    setValues,
    clearedSelectors,
    get backCount() {
      return backCount;
    },
    get hideKeyboardCount() {
      return hideKeyboardCount;
    },
    get acceptAlertCount() {
      return acceptAlertCount;
    },
    get dismissAlertCount() {
      return dismissAlertCount;
    },
    get deleteSessionCount() {
      return deleteSessionCount;
    },

    takeScreenshot: vi.fn(async () => options.screenshot ?? "data:image/png;base64,mockScreenshotData"),
    getPageSource: vi.fn(async () => options.pageSource ?? '<XCUIElementTypeApplication name="Settings" />'),
    getWindowSize: vi.fn(async () => options.windowSize ?? { width: 393, height: 852 }),
    getOrientation: vi.fn(async () => options.orientation ?? "PORTRAIT"),

    execute: vi.fn(async (script: string, ...args: unknown[]) => {
      executedScripts.push({ script, args });
      if (options.onExecute) {
        return options.onExecute(script, ...args);
      }
      if (script === "mobile: activeAppInfo") {
        return options.activeApp ?? { bundleId: "com.apple.Preferences", processId: 1234 };
      }
      return undefined;
    }),

    $: vi.fn(async (selector: string): Promise<WdioElement> => {
      const isExisting = existing.has(selector);
      return {
        isExisting: vi.fn(async () => isExisting),
        isDisplayed: vi.fn(async () => isExisting),
        click: vi.fn(async () => {
          if (failingClicks.has(selector)) {
            throw new Error(`Click failed on selector: ${selector}`);
          }
          clickedSelectors.push(selector);
        }),
        setValue: vi.fn(async (val: string) => {
          if (failingSetValues.has(selector)) {
            throw new Error(`setValue failed on selector: ${selector}`);
          }
          setValues.push({ selector, value: val });
        }),
        clearValue: vi.fn(async () => {
          if (failingClears.has(selector)) {
            throw new Error(`clearValue failed on selector: ${selector}`);
          }
          clearedSelectors.push(selector);
        }),
      };
    }),

    back: vi.fn(async () => {
      backCount += 1;
    }),

    hideKeyboard: vi.fn(async () => {
      hideKeyboardCount += 1;
    }),

    acceptAlert: vi.fn(async () => {
      acceptAlertCount += 1;
    }),

    dismissAlert: vi.fn(async () => {
      dismissAlertCount += 1;
    }),

    pause: vi.fn(async () => undefined),

    deleteSession: vi.fn(async () => {
      deleteSessionCount += 1;
      if (options.onDeleteSession) {
        await options.onDeleteSession();
      }
    }),

    status: vi.fn(async () => {
      if (options.onStatus) {
        return await options.onStatus();
      }
      return { ready: true };
    }),
  };
}

describe("Device Module", () => {
  const logger = createSilentLogger();

  describe("Session Capabilities & Connection Options (P2-T1)", () => {
    it("builds capabilities using signing configs when webDriverAgentUrl is null", () => {
      const config = createMockConfig({ webDriverAgentUrl: null });
      const caps = buildCapabilities(config);

      expect(caps["platformName"]).toBe("iOS");
      expect(caps["appium:automationName"]).toBe("XCUITest");
      expect(caps["appium:udid"]).toBe(config.device.udid);
      expect(caps["appium:bundleId"]).toBe(config.app.bundleId);
      expect(caps["appium:xcodeOrgId"]).toBe("TEAMID1234");
      expect(caps["appium:updatedWDABundleId"]).toBe("com.example.wda");
      expect(caps["appium:allowProvisioningDeviceRegistration"]).toBe(true);
      expect(caps["appium:webDriverAgentUrl"]).toBeUndefined();
    });

    it("builds capabilities using webDriverAgentUrl when configured", () => {
      const config = createMockConfig({ webDriverAgentUrl: "http://127.0.0.1:8100" });
      const caps = buildCapabilities(config);

      expect(caps["appium:webDriverAgentUrl"]).toBe("http://127.0.0.1:8100");
      expect(caps["appium:xcodeOrgId"]).toBeUndefined();
      expect(caps["appium:updatedWDABundleId"]).toBeUndefined();
    });

    it("builds connection options accurately", () => {
      const config = createMockConfig();
      const opts = buildConnectionOptions(config);

      expect(opts.hostname).toBe("127.0.0.1");
      expect(opts.port).toBe(4723);
      expect(opts.path).toBe("/");
      expect(opts.connectionRetryTimeout).toBe(30000);
    });
  });

  describe("SessionManager Lifecycle (P2-T1)", () => {
    it("connects with injected client override and tracks connection state", async () => {
      const config = createMockConfig();
      const mockClient = createMockWdioClient();
      const manager = new SessionManager(config, logger, mockClient);

      expect(manager.isConnected()).toBe(false);
      expect(() => manager.getClient()).toThrow("Device session is not connected");

      const client = await manager.connect();
      expect(client).toBe(mockClient);
      expect(manager.isConnected()).toBe(true);
      expect(manager.getClient()).toBe(mockClient);

      // Re-connecting returns existing client
      const reconnected = await manager.connect();
      expect(reconnected).toBe(mockClient);

      // Disconnecting terminates session cleanly
      await manager.disconnect();
      expect(mockClient.deleteSessionCount).toBe(1);
      expect(manager.isConnected()).toBe(false);
    });

    it("handles disconnect errors gracefully without unhandled exceptions", async () => {
      const config = createMockConfig();
      const mockClient = createMockWdioClient({
        onDeleteSession: () => {
          throw new Error("WDA session already dead");
        },
      });
      const manager = new SessionManager(config, logger, mockClient);

      await manager.connect();
      await expect(manager.disconnect()).resolves.toBeUndefined();
      expect(manager.isConnected()).toBe(false);
    });

    it("evaluates health status based on client responsiveness", async () => {
      const config = createMockConfig();
      const mockClient = createMockWdioClient({
        onStatus: async () => ({ ready: true }),
      });
      const manager = new SessionManager(config, logger, mockClient);

      expect(await manager.isHealthy()).toBe(false);

      await manager.connect();
      expect(await manager.isHealthy()).toBe(true);

      const failingMock = createMockWdioClient({
        onStatus: async () => {
          throw new Error("Connection reset");
        },
      });
      const failingManager = new SessionManager(config, logger, failingMock);
      await failingManager.connect();
      expect(await failingManager.isHealthy()).toBe(false);
    });

    it("maps session connection errors to appropriate AppError codes", () => {
      const config = createMockConfig();

      const connErr = mapSessionError(new Error("connect ECONNREFUSED 127.0.0.1:4723"), config);
      expect(connErr.code).toBe("UXR-DEV-002");
      expect(connErr.message).toContain("Appium server unreachable");

      const devErr = mapSessionError(new Error("device not connected or UDID invalid"), config);
      expect(devErr.code).toBe("UXR-DEV-001");
      expect(devErr.message).toContain("iOS device with UDID");

      const appErr = mapSessionError(new Error("bundleId com.apple.Preferences is not installed"), config);
      expect(appErr.code).toBe("UXR-DEV-003");
      expect(appErr.message).toContain("Target app");

      const alreadyAppErr = new AppError("UXR-DEV-001", "custom");
      expect(mapSessionError(alreadyAppErr, config)).toBe(alreadyAppErr);
    });

    it("withTimeout rejects when promise exceeds timeout limit", async () => {
      const slowPromise = new Promise((resolve) => setTimeout(resolve, 200));
      await expect(withTimeout(slowPromise, 20, "Operation timed out")).rejects.toThrow(
        "Operation timed out",
      );
    });
  });

  describe("Locator Selector Resolution and Priority (P2-T2, P2-T3)", () => {
    it("formats candidate selectors to WebdriverIO formats correctly", () => {
      expect(
        candidateToWdioSelector({ strategy: "accessibility_id", selector: "Settings", confidence: 1 }),
      ).toBe("~Settings");
      expect(
        candidateToWdioSelector({ strategy: "accessibility_id", selector: "~Settings", confidence: 1 }),
      ).toBe("~Settings");

      expect(
        candidateToWdioSelector({
          strategy: "predicate",
          selector: 'name == "Wi-Fi"',
          confidence: 0.8,
        }),
      ).toBe('-ios predicate string:name == "Wi-Fi"');
      expect(
        candidateToWdioSelector({
          strategy: "predicate",
          selector: '-ios predicate string:name == "Wi-Fi"',
          confidence: 0.8,
        }),
      ).toBe('-ios predicate string:name == "Wi-Fi"');

      expect(
        candidateToWdioSelector({
          strategy: "class_chain",
          selector: "**/XCUIElementTypeCell[`name == 'Wi-Fi'`]",
          confidence: 0.7,
        }),
      ).toBe("-ios class chain:**/XCUIElementTypeCell[`name == 'Wi-Fi'`]");

      expect(
        candidateToWdioSelector({
          strategy: "xpath",
          selector: "//XCUIElementTypeCell[@name='Wi-Fi']",
          confidence: 0.5,
        }),
      ).toBe("//XCUIElementTypeCell[@name='Wi-Fi']");
      expect(
        candidateToWdioSelector({
          strategy: "xpath",
          selector: "XCUIElementTypeCell[@name='Wi-Fi']",
          confidence: 0.5,
        }),
      ).toBe("xpath=XCUIElementTypeCell[@name='Wi-Fi']");
    });

    it("prioritizes candidates in order: accessibility_id -> predicate -> class_chain -> xpath", () => {
      const candidates: LocatorCandidate[] = [
        { strategy: "xpath", selector: "//cell", confidence: 0.99 },
        { strategy: "class_chain", selector: "**/cell", confidence: 0.95 },
        { strategy: "accessibility_id", selector: "cell_id", confidence: 0.5 },
        { strategy: "predicate", selector: "name == 'cell'", confidence: 0.8 },
      ];

      const sorted = prioritizeCandidates(candidates);
      expect(sorted.map((c) => c.strategy)).toEqual([
        "accessibility_id",
        "predicate",
        "class_chain",
        "xpath",
      ]);
    });

    it("breaks strategy ties with higher confidence first", () => {
      const candidates: LocatorCandidate[] = [
        { strategy: "predicate", selector: "label == 'Wi-Fi'", confidence: 0.6 },
        { strategy: "predicate", selector: "name == 'Wi-Fi'", confidence: 0.9 },
      ];

      const sorted = prioritizeCandidates(candidates);
      expect(sorted[0]?.selector).toBe("name == 'Wi-Fi'");
      expect(sorted[1]?.selector).toBe("label == 'Wi-Fi'");
    });
  });

  describe("RealDeviceAdapter Actions & Fallback Execution (P2-T3, P2-T4)", () => {
    it("taps element with accessibility_id when it exists", async () => {
      const config = createMockConfig();
      const mockClient = createMockWdioClient({
        existingSelectors: ["~Wi-Fi"],
      });
      const sessionManager = new SessionManager(config, logger, mockClient);
      const adapter = new RealDeviceAdapter(config, sessionManager, logger);
      await adapter.connect();

      const element = createDummyUIElement([
        { strategy: "accessibility_id", selector: "Wi-Fi", confidence: 0.9 },
        { strategy: "xpath", selector: "//cell", confidence: 0.5 },
      ]);

      const result = await adapter.tap(element);
      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(mockClient.clickedSelectors).toEqual(["~Wi-Fi"]);
    });

    it("falls back to predicate when accessibility_id does not exist", async () => {
      const config = createMockConfig();
      const predicateSelector = '-ios predicate string:name == "Wi-Fi"';
      const mockClient = createMockWdioClient({
        existingSelectors: [predicateSelector],
      });
      const sessionManager = new SessionManager(config, logger, mockClient);
      const adapter = new RealDeviceAdapter(config, sessionManager, logger);
      await adapter.connect();

      const element = createDummyUIElement([
        { strategy: "accessibility_id", selector: "Wi-Fi", confidence: 0.9 },
        { strategy: "predicate", selector: 'name == "Wi-Fi"', confidence: 0.8 },
        { strategy: "xpath", selector: "//cell", confidence: 0.4 },
      ]);

      const result = await adapter.tap(element);
      expect(result.success).toBe(true);
      expect(mockClient.clickedSelectors).toEqual([predicateSelector]);
    });

    it("falls back to next candidate when click throws an error", async () => {
      const config = createMockConfig();
      const classChainSelector = "-ios class chain:**/XCUIElementTypeCell";
      const mockClient = createMockWdioClient({
        existingSelectors: ["~Wi-Fi", classChainSelector],
        failingClickSelectors: ["~Wi-Fi"],
      });
      const sessionManager = new SessionManager(config, logger, mockClient);
      const adapter = new RealDeviceAdapter(config, sessionManager, logger);
      await adapter.connect();

      const element = createDummyUIElement([
        { strategy: "accessibility_id", selector: "Wi-Fi", confidence: 0.9 },
        { strategy: "class_chain", selector: "**/XCUIElementTypeCell", confidence: 0.7 },
      ]);

      const result = await adapter.tap(element);
      expect(result.success).toBe(true);
      expect(mockClient.clickedSelectors).toEqual([classChainSelector]);
    });

    it("reports failure when all locator candidates fail", async () => {
      const config = createMockConfig();
      const mockClient = createMockWdioClient({
        existingSelectors: [],
      });
      const sessionManager = new SessionManager(config, logger, mockClient);
      const adapter = new RealDeviceAdapter(config, sessionManager, logger);
      await adapter.connect();

      const element = createDummyUIElement([
        { strategy: "accessibility_id", selector: "Wi-Fi", confidence: 0.9 },
      ]);

      const result = await adapter.tap(element);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to tap element elem_01");
    });

    it("reports failure when element has no locator candidates", async () => {
      const config = createMockConfig();
      const mockClient = createMockWdioClient();
      const sessionManager = new SessionManager(config, logger, mockClient);
      const adapter = new RealDeviceAdapter(config, sessionManager, logger);
      await adapter.connect();

      const element = createDummyUIElement([]);
      const result = await adapter.tap(element);
      expect(result.success).toBe(false);
      expect(result.error).toContain("No locator candidates provided");
    });

    it("executes typeText and clearText with fallback", async () => {
      const config = createMockConfig();
      const mockClient = createMockWdioClient({
        existingSelectors: ["~SearchField"],
      });
      const sessionManager = new SessionManager(config, logger, mockClient);
      const adapter = new RealDeviceAdapter(config, sessionManager, logger);
      await adapter.connect();

      const element = createDummyUIElement([
        { strategy: "accessibility_id", selector: "SearchField", confidence: 1 },
      ]);

      const typeRes = await adapter.typeText(element, "Bluetooth");
      expect(typeRes.success).toBe(true);
      expect(mockClient.setValues).toEqual([{ selector: "~SearchField", value: "Bluetooth" }]);

      const clearRes = await adapter.clearText(element);
      expect(clearRes.success).toBe(true);
      expect(mockClient.clearedSelectors).toEqual(["~SearchField"]);
    });
  });

  describe("RealDeviceAdapter Global Operations & Read Methods (P2-T4)", () => {
    it("scrolls with mobile: scroll and falls back to mobile: swipe on error", async () => {
      const config = createMockConfig();
      let scrollCalled = false;
      let swipeCalled = false;

      const mockClient = createMockWdioClient({
        onExecute: (script) => {
          if (script === "mobile: scroll") {
            scrollCalled = true;
            throw new Error("No scrollable container");
          }
          if (script === "mobile: swipe") {
            swipeCalled = true;
            return undefined;
          }
          return undefined;
        },
      });

      const sessionManager = new SessionManager(config, logger, mockClient);
      const adapter = new RealDeviceAdapter(config, sessionManager, logger);
      await adapter.connect();

      const result = await adapter.scroll("down");
      expect(scrollCalled).toBe(true);
      expect(swipeCalled).toBe(true);
      expect(result.success).toBe(true);
    });

    it("handles back navigation via mobile: pressButton and fallback", async () => {
      const config = createMockConfig();
      const mockClient = createMockWdioClient({
        onExecute: (script) => {
          if (script === "mobile: pressButton") {
            throw new Error("pressButton unsupported");
          }
          return undefined;
        },
      });

      const sessionManager = new SessionManager(config, logger, mockClient);
      const adapter = new RealDeviceAdapter(config, sessionManager, logger);
      await adapter.connect();

      const result = await adapter.back();
      expect(result.success).toBe(true);
      expect(mockClient.backCount).toBe(1);
    });

    it("handles dismissKeyboard and alert actions", async () => {
      const config = createMockConfig();
      const mockClient = createMockWdioClient();
      const sessionManager = new SessionManager(config, logger, mockClient);
      const adapter = new RealDeviceAdapter(config, sessionManager, logger);
      await adapter.connect();

      const dismissed = await adapter.dismissKeyboard();
      expect(dismissed).toBe(true);

      const alertAccept = await adapter.handleAlert("accept");
      expect(alertAccept).toBe(true);
      expect(mockClient.acceptAlertCount).toBe(1);

      const alertDismiss = await adapter.handleAlert("dismiss");
      expect(alertDismiss).toBe(true);
      expect(mockClient.dismissAlertCount).toBe(1);
    });

    it("restarts target app using bundleId", async () => {
      const config = createMockConfig();
      const mockClient = createMockWdioClient();
      const sessionManager = new SessionManager(config, logger, mockClient);
      const adapter = new RealDeviceAdapter(config, sessionManager, logger);
      await adapter.connect();

      await adapter.restartApp("com.apple.mobilesafari");
      const scripts = mockClient.executedScripts.map((s) => s.script);
      expect(scripts).toContain("mobile: terminateApp");
      expect(scripts).toContain("mobile: launchApp");
    });

    it("reads screenshot, page source, viewport, orientation, and active app", async () => {
      const config = createMockConfig();
      const mockClient = createMockWdioClient({
        screenshot: "base64EncodedScreenshotString",
        pageSource: "<xml>Hierarchy</xml>",
        windowSize: { width: 400, height: 800 },
        orientation: "PORTRAIT",
        activeApp: { bundleId: "com.apple.Preferences", pid: 9999 },
      });

      const sessionManager = new SessionManager(config, logger, mockClient);
      const adapter = new RealDeviceAdapter(config, sessionManager, logger);
      await adapter.connect();

      expect(await adapter.takeScreenshot()).toBe("base64EncodedScreenshotString");
      expect(await adapter.getPageSource()).toBe("<xml>Hierarchy</xml>");
      expect(await adapter.getViewport()).toEqual({ width: 400, height: 800 });
      expect(await adapter.getOrientation()).toBe("PORTRAIT");

      const activeApp = await adapter.getActiveApp();
      expect(activeApp.bundleId).toBe("com.apple.Preferences");
      expect(activeApp.processId).toBe(9999);
    });
  });

  describe("DryRunDeviceAdapter (P2-T5)", () => {
    it("intercepts all write actions, records them, and does not invoke real device commands", async () => {
      const config = createMockConfig({ dryRun: true });
      const mockClient = createMockWdioClient({
        existingSelectors: ["~Wi-Fi"],
      });
      const sessionManager = new SessionManager(config, logger, mockClient);
      const realAdapter = new RealDeviceAdapter(config, sessionManager, logger);
      const dryRunAdapter = new DryRunDeviceAdapter(realAdapter, logger);

      await dryRunAdapter.connect();

      const element = createDummyUIElement([
        { strategy: "accessibility_id", selector: "Wi-Fi", confidence: 0.9 },
      ]);

      // Tap
      const tapRes = await dryRunAdapter.tap(element);
      expect(tapRes.success).toBe(true);
      expect(mockClient.clickedSelectors).toHaveLength(0);

      // Type
      const typeRes = await dryRunAdapter.typeText(element, "Test Input");
      expect(typeRes.success).toBe(true);
      expect(mockClient.setValues).toHaveLength(0);

      // Clear
      const clearRes = await dryRunAdapter.clearText(element);
      expect(clearRes.success).toBe(true);
      expect(mockClient.clearedSelectors).toHaveLength(0);

      // Scroll
      const scrollRes = await dryRunAdapter.scroll("up");
      expect(scrollRes.success).toBe(true);

      // Back
      const backRes = await dryRunAdapter.back();
      expect(backRes.success).toBe(true);
      expect(mockClient.backCount).toBe(0);

      // Dismiss Keyboard
      const dismissRes = await dryRunAdapter.dismissKeyboard();
      expect(dismissRes).toBe(true);
      expect(mockClient.hideKeyboardCount).toBe(0);

      // Handle Alert
      const alertRes = await dryRunAdapter.handleAlert("accept");
      expect(alertRes).toBe(true);
      expect(mockClient.acceptAlertCount).toBe(0);

      // Restart App
      await dryRunAdapter.restartApp("com.apple.Preferences");

      // Verify recorded actions list
      const recorded = dryRunAdapter.getRecordedActions();
      expect(recorded.map((r) => r.kind)).toEqual([
        "tap",
        "type",
        "clear",
        "scroll",
        "back",
        "dismissKeyboard",
        "handleAlert",
        "restartApp",
      ]);

      expect(recorded[0]?.target?.elementId).toBe("elem_01");
      expect(recorded[1]?.text).toBe("Test Input");
      expect(recorded[3]?.direction).toBe("up");
      expect(recorded[6]?.alertAction).toBe("accept");
      expect(recorded[7]?.bundleId).toBe("com.apple.Preferences");

      dryRunAdapter.clearRecordedActions();
      expect(dryRunAdapter.getRecordedActions()).toHaveLength(0);
    });

    it("passes through all read operations in dry-run mode", async () => {
      const config = createMockConfig({ dryRun: true });
      const mockClient = createMockWdioClient({
        screenshot: "screenshot_through_dry_run",
        pageSource: "<xml>DryRunXML</xml>",
        windowSize: { width: 375, height: 667 },
        orientation: "LANDSCAPE",
        activeApp: { bundleId: "com.apple.Preferences", pid: 42 },
      });
      const sessionManager = new SessionManager(config, logger, mockClient);
      const realAdapter = new RealDeviceAdapter(config, sessionManager, logger);
      const dryRunAdapter = new DryRunDeviceAdapter(realAdapter, logger);

      await dryRunAdapter.connect();

      expect(await dryRunAdapter.takeScreenshot()).toBe("screenshot_through_dry_run");
      expect(await dryRunAdapter.getPageSource()).toBe("<xml>DryRunXML</xml>");
      expect(await dryRunAdapter.getViewport()).toEqual({ width: 375, height: 667 });
      expect(await dryRunAdapter.getOrientation()).toBe("LANDSCAPE");

      const activeApp = await dryRunAdapter.getActiveApp();
      expect(activeApp.bundleId).toBe("com.apple.Preferences");
      expect(activeApp.processId).toBe(42);

      expect(await dryRunAdapter.isHealthy()).toBe(true);
    });
  });

  describe("createDeviceAdapter Factory", () => {
    it("creates RealDeviceAdapter when dryRun is false", () => {
      const config = createMockConfig({ dryRun: false });
      const mockClient = createMockWdioClient();
      const adapter = createDeviceAdapter(config, logger, mockClient);

      expect(adapter).toBeInstanceOf(RealDeviceAdapter);
    });

    it("wraps with DryRunDeviceAdapter when dryRun is true", () => {
      const config = createMockConfig({ dryRun: true });
      const mockClient = createMockWdioClient();
      const adapter = createDeviceAdapter(config, logger, mockClient);

      expect(adapter).toBeInstanceOf(DryRunDeviceAdapter);
    });
  });
});
