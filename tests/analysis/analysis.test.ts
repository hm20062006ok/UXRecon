import { describe, expect, it } from "vitest";
import {
  auditPageUx,
  extractDesignTokens,
  generateGalleryHtml,
  generateScreenSpec,
} from "../../src/analysis/index.js";
import type { PageState, UIElement } from "../../src/types/contracts.js";

function makeElement(
  bounds: { x: number; y: number; width: number; height: number },
  label = "OK",
): UIElement {
  return {
    elementId: "el-1",
    semanticId: "btn-ok",
    type: "XCUIElementTypeButton",
    label,
    name: label,
    value: "",
    bounds,
    enabled: true,
    visible: true,
    selected: false,
    locatorCandidates: [],
    possibleActions: ["tap"],
    source: "accessibility",
    confidence: 1.0,
  };
}

describe("Analysis and Gallery Generation", () => {
  it("generates component screen specs", () => {
    const page: PageState = {
      pageId: "home",
      fingerprints: { exact: "ex", structural: "st" },
      observationId: "obs-1",
      interactiveElements: [],
      visitedActionKeys: [],
      pendingActionKeys: [],
      status: "complete",
      firstSeenAt: new Date().toISOString(),
      lastVisitedAt: new Date().toISOString(),
    };

    const el = makeElement({ x: 10, y: 20, width: 100, height: 44 });
    const spec = generateScreenSpec(page, [el], { width: 393, height: 852 });

    expect(spec.schemaVersion).toBe(1);
    expect(spec.components).toHaveLength(1);
    expect(spec.components[0]?.bounds.width).toBe(100);
    expect(spec.components[0]?.provenance).toBe("observed");
  });

  it("extracts design token scales from elements", () => {
    const elements = [
      makeElement({ x: 0, y: 0, width: 80, height: 44 }),
      makeElement({ x: 0, y: 0, width: 120, height: 48 }),
    ];
    const tokens = extractDesignTokens(elements);

    expect(tokens.spacingScale).toContain(8);
    expect(tokens.spacingScale).toContain(16);
    expect(tokens.inferredRadii).toContain(12);
  });

  it("flags UX violations for touch targets below 44 pt and missing labels", () => {
    const tinyElement = makeElement({ x: 0, y: 0, width: 24, height: 24 }, "");
    const goodElement = makeElement({ x: 0, y: 0, width: 60, height: 50 }, "Submit");

    const report = auditPageUx("home", [tinyElement, goodElement]);

    expect(report.score).toBeLessThan(100);
    const ruleIds = report.issues.map((i) => i.ruleId);
    expect(ruleIds).toContain("a11y.touch-target-size");
    expect(ruleIds).toContain("a11y.missing-accessible-label");
  });

  it("generates self-contained offline HTML gallery", () => {
    const html = generateGalleryHtml(
      "Test Run",
      [
        {
          step: 1,
          fromPage: "home",
          toPage: "market",
          action: "tap",
          screenshotRelPath: "screenshots/000001.png",
          durationMs: 120,
          result: "changed",
        },
      ],
      [],
    );

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("UXRecon Gallery");
    expect(html).toContain("screenshots/000001.png");
    expect(html).toContain("home &rarr; market");
  });
});
