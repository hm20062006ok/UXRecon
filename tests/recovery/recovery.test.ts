import { describe, expect, it, vi } from "vitest";
import { createSilentLogger } from "../../src/logging/index.js";
import { RecoveryLadder } from "../../src/recovery/index.js";
import type { PageState, UIElement } from "../../src/types/contracts.js";

function makeFakeDevice() {
  return {
    tap: vi.fn().mockResolvedValue({ success: true, durationMs: 50 }),
    dismissKeyboard: vi.fn().mockResolvedValue(true),
    handleAlert: vi.fn().mockResolvedValue(true),
    restartApp: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function makeExpectedPage(): PageState {
  return {
    pageId: "page-parent",
    fingerprints: { exact: "exact-parent", structural: "struct-parent" },
    observationId: "obs-1",
    interactiveElements: [],
    visitedActionKeys: [],
    pendingActionKeys: [],
    status: "exploring",
    firstSeenAt: new Date().toISOString(),
    lastVisitedAt: new Date().toISOString(),
  };
}

describe("RecoveryLadder", () => {
  const ladder = new RecoveryLadder("com.global.wallet.ios", createSilentLogger());

  it("verifies structural fingerprint matching", () => {
    expect(ladder.verifyRestoration("struct-a", "struct-a")).toBe(true);
    expect(ladder.verifyRestoration("struct-a", "struct-b")).toBe(false);
  });

  it("uses Level 1 in-app back button when available", async () => {
    const device = makeFakeDevice();
    const expectedPage = makeExpectedPage();
    const backBtn: UIElement = {
      elementId: "el-back",
      semanticId: "btn-back",
      type: "XCUIElementTypeButton",
      label: "Back",
      name: "nav_back",
      value: "",
      bounds: { x: 0, y: 0, width: 44, height: 44 },
      enabled: true,
      visible: true,
      selected: false,
      locatorCandidates: [],
      possibleActions: ["tap"],
      source: "accessibility",
      confidence: 1.0,
    };

    const res = await ladder.recover(device, expectedPage, [backBtn]);
    expect(res.recovered).toBe(true);
    expect(res.level).toBe("in-app-back");
    expect(device.tap).toHaveBeenCalledWith(backBtn);
  });

  it("falls back to Level 2/3 relaunch when no in-app back button is found", async () => {
    const device = makeFakeDevice();
    const expectedPage = makeExpectedPage();

    const res = await ladder.recover(device, expectedPage, []);
    expect(res.recovered).toBe(true);
    expect(res.level).toBe("app-relaunch");
    expect(device.dismissKeyboard).toHaveBeenCalled();
    expect(device.handleAlert).toHaveBeenCalledWith("dismiss");
    expect(device.restartApp).toHaveBeenCalledWith("com.global.wallet.ios");
  });
});
