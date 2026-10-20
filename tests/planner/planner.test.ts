import { describe, expect, it } from "vitest";
import { createSilentLogger } from "../../src/logging/index.js";
import {
  buildPlannerPrompt,
  createPlanner,
  DeterministicPlanner,
  parsePlannedAction,
  type PlanContext,
} from "../../src/planner/index.js";
import type { UIElement } from "../../src/types/contracts.js";

function makeElement(
  id: string,
  semanticId: string,
  actions: ("tap" | "type" | "scroll")[] = ["tap"],
): UIElement {
  return {
    elementId: id,
    semanticId,
    type: "XCUIElementTypeButton",
    label: semanticId,
    name: semanticId,
    value: "",
    bounds: { x: 0, y: 0, width: 50, height: 50 },
    enabled: true,
    visible: true,
    selected: false,
    locatorCandidates: [],
    possibleActions: actions,
    source: "accessibility",
    confidence: 1.0,
  };
}

describe("plannedActionSchema / parsePlannedAction", () => {
  it("parses valid planned actions", () => {
    const action = parsePlannedAction({
      kind: "tap",
      targetElementId: "el-1",
      targetSemanticId: "btn-market",
      reason: "Explore market view",
      expectedEffect: "Opens Market screen",
      risk: "low",
      confidence: 0.95,
    });

    expect(action.kind).toBe("tap");
    expect(action.targetElementId).toBe("el-1");
    expect(action.reason).toBe("Explore market view");
  });

  it("rejects unknown action kinds or extra unknown properties", () => {
    expect(() =>
      parsePlannedAction({
        kind: "unknown_magic_click",
        reason: "test",
        expectedEffect: "test",
      }),
    ).toThrow();

    expect(() =>
      parsePlannedAction({
        kind: "tap",
        reason: "test",
        expectedEffect: "test",
        maliciousExtraProperty: "inject",
      }),
    ).toThrow();
  });
});

describe("DeterministicPlanner", () => {
  const planner = new DeterministicPlanner();

  it("selects unvisited interactive elements sequentially", async () => {
    const el1 = makeElement("1", "btn-tab-market");
    const el2 = makeElement("2", "btn-tab-assets");

    const context: PlanContext = {
      pageId: "home",
      elements: [el1, el2],
      interactiveElements: [el1, el2],
      visitedActionKeys: ["home::tap::btn-tab-market"],
      pendingActionKeys: [],
      depth: 0,
      maxDepth: 5,
    };

    const action = await planner.planNextAction(context);
    expect(action.kind).toBe("tap");
    expect(action.targetSemanticId).toBe("btn-tab-assets");
  });

  it("backtracks with back when max depth is reached", async () => {
    const el = makeElement("1", "btn-next");
    const context: PlanContext = {
      pageId: "deep-page",
      elements: [el],
      interactiveElements: [el],
      visitedActionKeys: [],
      pendingActionKeys: [],
      depth: 6,
      maxDepth: 6,
    };

    const action = await planner.planNextAction(context);
    expect(action.kind).toBe("back");
    expect(action.reason).toContain("maximum exploration depth");
  });

  it("stops when root page has no remaining unvisited elements", async () => {
    const el = makeElement("1", "btn-home");
    const context: PlanContext = {
      pageId: "root",
      elements: [el],
      interactiveElements: [el],
      visitedActionKeys: ["root::tap::btn-home"],
      pendingActionKeys: [],
      depth: 0,
      maxDepth: 5,
    };

    const action = await planner.planNextAction(context);
    expect(action.kind).toBe("stop");
    expect(action.reason).toContain("Completed traversal");
  });
});

describe("buildPlannerPrompt", () => {
  it("generates structured JSON prompt with elements summary", () => {
    const el = makeElement("e1", "btn-start");
    const prompt = buildPlannerPrompt({
      pageId: "welcome",
      elements: [el],
      interactiveElements: [el],
      visitedActionKeys: [],
      pendingActionKeys: [],
      depth: 1,
      maxDepth: 4,
    });

    const parsed = JSON.parse(prompt);
    expect(parsed.currentPageId).toBe("welcome");
    expect(parsed.availableElements[0].semanticId).toBe("btn-start");
    expect(parsed.instructions).toBeDefined();
  });
});

describe("createPlanner", () => {
  it("creates deterministic planner when agent provider is none", () => {
    const planner = createPlanner(
      {
        agent: {
          provider: "none",
          command: "codex",
          model: null,
          args: [],
          timeoutMs: 1000,
        },
      } as any,
      createSilentLogger(),
    );

    expect(planner).toBeInstanceOf(DeterministicPlanner);
  });
});
