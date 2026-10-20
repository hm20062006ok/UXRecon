import { existsSync, readFileSync, rmSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { generateReplicationBlueprint, type BlueprintGeneratorInput } from "../../src/analysis/blueprint.js";
import type { PageState, Transition, UIElement } from "../../src/types/contracts.js";

describe("generateReplicationBlueprint", () => {
  const testDir = path.join(process.cwd(), "tmp", `test-blueprint-${Date.now()}`);

  it("generates app-blueprint.json and REPLICATION_GUIDE.md", () => {
    const page: PageState = {
      pageId: "page-assets",
      fingerprints: { exact: "exact-1", structural: "struct-1" },
      observationId: "obs-000001",
      interactiveElements: [],
      visitedActionKeys: [],
      pendingActionKeys: [],
      status: "complete",
      firstSeenAt: new Date().toISOString(),
      lastVisitedAt: new Date().toISOString(),
    };

    const element: UIElement = {
      elementId: "el-1",
      semanticId: "btn-create-wallet",
      type: "XCUIElementTypeButton",
      label: "I don't have a wallet",
      name: "I don't have a wallet",
      value: "",
      bounds: { x: 84, y: 646, width: 147, height: 21 },
      enabled: true,
      visible: true,
      selected: false,
      locatorCandidates: [],
      possibleActions: ["tap"],
      source: "accessibility",
      confidence: 1.0,
    };

    const transition: Transition = {
      transitionId: "trans-000001",
      fromPageId: "page-assets",
      toPageId: "page-create-wallet",
      action: {
        kind: "tap",
        targetElementId: "el-1",
        reason: "Navigate to wallet creation flow",
        expectedEffect: "Opens wallet generation setup screen",
        risk: "low",
        confidence: 1.0,
        agentThought: "User wants to create a new wallet. Tap button.",
        screenDescription: "Welcome screen with wallet options.",
      },
      actionKey: "key-1",
      beforeObservationId: "obs-000001",
      afterObservationId: "obs-000002",
      startedAt: new Date().toISOString(),
      durationMs: 350,
      result: "changed",
      uxObservations: [],
      agentThought: "User wants to create a new wallet. Tap button.",
      screenDescription: "Welcome screen with wallet options.",
    };

    const input: BlueprintGeneratorInput = {
      runDir: testDir,
      appName: "TokenPocket",
      bundleId: "com.global.wallet.ios",
      viewport: { width: 428, height: 926 },
      goal: "点击 Assets -- I don't have a wallet，进入页面后提取里面的完整交互",
      pages: [page],
      pageElementsMap: new Map([[page.pageId, [element]]]),
      observationMap: new Map([
        ["obs-000001", { screenshotPath: path.join(testDir, "screenshots", "001.png") }],
        ["obs-000002", { screenshotPath: path.join(testDir, "screenshots", "002.png") }],
      ]),
      transitions: [transition],
      designTokens: {
        schemaVersion: 1,
        spacingScale: [4, 8, 12, 16, 24],
        commonSizes: [{ width: 147, height: 21 }],
        inferredRadii: [8],
      },
    };

    const blueprint = generateReplicationBlueprint(input);

    expect(blueprint.summary.totalSteps).toBe(1);
    expect(blueprint.summary.totalPages).toBe(1);
    expect(blueprint.goal).toContain("I don't have a wallet");
    expect(blueprint.steps[0]!.targetLabel).toBe("I don't have a wallet");
    expect(blueprint.steps[0]!.agentThought).toContain("User wants to create a new wallet");

    const jsonPath = path.join(testDir, "blueprint", "app-blueprint.json");
    const mdPath = path.join(testDir, "blueprint", "REPLICATION_GUIDE.md");

    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(mdPath)).toBe(true);

    const mdContent = readFileSync(mdPath, "utf8");
    expect(mdContent).toContain("App Replication & Reverse-Engineering Dossier");
    expect(mdContent).toContain("System Prompt for App Replicator Agent");
    expect(mdContent).toContain("I don't have a wallet");
    expect(mdContent).toContain("TokenPocket");

    // Clean up
    rmSync(testDir, { recursive: true, force: true });
  });
});
