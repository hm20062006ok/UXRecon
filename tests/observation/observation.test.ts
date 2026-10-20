import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterInteractiveElements,
  inferPossibleActions,
  parsePageSource,
} from "../../src/observation/index.js";
import type { UIElement } from "../../src/types/contracts.js";

const ARTIFACTS_DIR = path.resolve(__dirname, "../../artifacts/p0-real-device-2026-10-20T05-46-44-165Z");

describe("P3-T1: XML Parser (parsePageSource & parseElements)", () => {
  it("parses real device 000-initial.xml into structured elements", async () => {
    const xml = await readFile(path.join(ARTIFACTS_DIR, "000-initial.xml"), "utf8");
    const result = parsePageSource(xml);

    expect(result.elements.length).toBeGreaterThan(20);
    expect(result.keyboardVisible).toBe(false);
    expect(result.systemAlert).toBe(false);
    expect(result.tree.type).toBe("AppiumAUT");

    // Decodes XML entities properly (&amp; -> &)
    const entityTextElement = result.elements.find((e) =>
      e.label.includes("Import Wallet, KeyPal & MultiSig Wallet"),
    );
    expect(entityTextElement).toBeDefined();
    expect(entityTextElement?.label).toBe("Import Wallet, KeyPal & MultiSig Wallet");
    expect(entityTextElement?.value).toBe("Import Wallet, KeyPal & MultiSig Wallet");

    // Finds tab bar buttons
    const assetsButton = result.elements.find(
      (e) => e.type === "XCUIElementTypeButton" && e.name === "Assets",
    );
    expect(assetsButton).toBeDefined();
    expect(assetsButton?.bounds).toEqual({ x: 2, y: 844, width: 83, height: 48 });
    expect(assetsButton?.selected).toBe(true);
    expect(assetsButton?.possibleActions).toEqual(["tap"]);

    const marketButton = result.elements.find(
      (e) => e.type === "XCUIElementTypeButton" && e.name === "Market",
    );
    expect(marketButton).toBeDefined();
    expect(marketButton?.selected).toBe(false);
    expect(marketButton?.possibleActions).toEqual(["tap"]);
  });

  it("generates 4 prioritized locator candidates with confidence scores", async () => {
    const xml = await readFile(path.join(ARTIFACTS_DIR, "000-initial.xml"), "utf8");
    const { elements } = parsePageSource(xml);

    const marketBtn = elements.find((e) => e.type === "XCUIElementTypeButton" && e.name === "Market")!;
    expect(marketBtn).toBeDefined();

    const strategies = marketBtn.locatorCandidates.map((c) => c.strategy);
    expect(strategies).toContain("accessibility_id");
    expect(strategies).toContain("predicate");
    expect(strategies).toContain("class_chain");
    expect(strategies).toContain("xpath");

    // Confidence is sorted descending
    for (let i = 0; i < marketBtn.locatorCandidates.length - 1; i++) {
      expect(marketBtn.locatorCandidates[i]!.confidence).toBeGreaterThanOrEqual(
        marketBtn.locatorCandidates[i + 1]!.confidence,
      );
    }

    const a11y = marketBtn.locatorCandidates.find((c) => c.strategy === "accessibility_id");
    expect(a11y?.selector).toBe("Market");
    expect(a11y?.confidence).toBe(0.95);

    const pred = marketBtn.locatorCandidates.find((c) => c.strategy === "predicate");
    expect(pred?.selector).toContain('type == "XCUIElementTypeButton"');
    expect(pred?.selector).toContain('name == "Market"');

    const chain = marketBtn.locatorCandidates.find((c) => c.strategy === "class_chain");
    expect(chain?.selector).toBe('**/XCUIElementTypeButton[`name == "Market"`]');

    const xpath = marketBtn.locatorCandidates.find((c) => c.strategy === "xpath");
    expect(xpath?.selector).toBe('//XCUIElementTypeButton[@name="Market"]');
  });

  it("infers possible actions correctly across control types", () => {
    expect(inferPossibleActions("XCUIElementTypeButton", { enabled: "true" })).toEqual(["tap"]);
    expect(inferPossibleActions("XCUIElementTypeLink", { enabled: "true" })).toEqual(["tap"]);
    expect(inferPossibleActions("XCUIElementTypeCell", { enabled: "true" })).toEqual(["tap"]);
    expect(inferPossibleActions("XCUIElementTypeTextField", { enabled: "true" })).toEqual([
      "tap",
      "type",
      "clear",
    ]);
    expect(inferPossibleActions("XCUIElementTypeSecureTextField", { enabled: "true" })).toEqual([
      "tap",
      "type",
      "clear",
    ]);
    expect(inferPossibleActions("XCUIElementTypeScrollView", { enabled: "true" })).toEqual(["scroll"]);
    expect(inferPossibleActions("XCUIElementTypeButton", { enabled: "false" })).toEqual([]);
    expect(inferPossibleActions("XCUIElementTypeStaticText", { traits: "Button", enabled: "true" })).toEqual([
      "tap",
    ]);
    expect(inferPossibleActions("XCUIElementTypeStaticText", { traits: "", enabled: "true" })).toEqual([]);
  });

  it("detects keyboard and alert overlays", () => {
    const keyboardXml = `
      <AppiumAUT>
        <XCUIElementTypeApplication name="App" enabled="true" visible="true" x="0" y="0" width="428" height="926">
          <XCUIElementTypeKeyboard enabled="true" visible="true" x="0" y="600" width="428" height="326" />
        </XCUIElementTypeApplication>
      </AppiumAUT>
    `;
    const resKb = parsePageSource(keyboardXml);
    expect(resKb.keyboardVisible).toBe(true);
    expect(resKb.systemAlert).toBe(false);

    const alertXml = `
      <AppiumAUT>
        <XCUIElementTypeApplication name="App" enabled="true" visible="true" x="0" y="0" width="428" height="926">
          <XCUIElementTypeAlert name="Notice" enabled="true" visible="true" x="50" y="300" width="328" height="200" />
        </XCUIElementTypeApplication>
      </AppiumAUT>
    `;
    const resAlert = parsePageSource(alertXml);
    expect(resAlert.systemAlert).toBe(true);
    expect(resAlert.keyboardVisible).toBe(false);
  });
});

describe("P3-T2: Interactive Element Filtering", () => {
  const viewport = { width: 428, height: 926 };

  it("filters invisible, offscreen, and zero-dimension elements on real XML", async () => {
    const xml = await readFile(path.join(ARTIFACTS_DIR, "000-initial.xml"), "utf8");
    const { elements, tree } = parsePageSource(xml);

    const interactive = filterInteractiveElements(elements, { viewport, tree });

    // Interactive elements should be non-empty and much smaller than all raw elements
    expect(interactive.length).toBeGreaterThan(0);
    expect(interactive.length).toBeLessThan(elements.length);

    // No elements with visible === false
    expect(interactive.every((e) => e.visible)).toBe(true);

    // No elements with enabled === false
    expect(interactive.every((e) => e.enabled)).toBe(true);

    // No zero-size elements
    expect(interactive.every((e) => e.bounds.width >= 5 && e.bounds.height >= 5)).toBe(true);

    // No offscreen elements (e.g. x < -1 or x >= viewport.width)
    expect(
      interactive.every(
        (e) =>
          e.bounds.x >= -1 && e.bounds.y >= -1 && e.bounds.x < viewport.width && e.bounds.y < viewport.height,
      ),
    ).toBe(true);

    // No pure containers (XCUIElementTypeApplication, Window, Other)
    expect(
      interactive.some(
        (e) =>
          e.type === "XCUIElementTypeApplication" ||
          e.type === "XCUIElementTypeWindow" ||
          e.type === "XCUIElementTypeOther",
      ),
    ).toBe(false);

    // Real tab bar buttons are retained
    const interactiveNames = interactive.map((e) => e.name);
    expect(interactiveNames).toContain("Assets");
    expect(interactiveNames).toContain("Market");
    expect(interactiveNames).toContain("Trade");
    expect(interactiveNames).toContain("Discover");
    expect(interactiveNames).toContain("Me");
  });

  it("deduplicates button container vs child text element", () => {
    const parentButton: UIElement = {
      elementId: "elem_0",
      semanticId: "Button::submit::10_20",
      type: "XCUIElementTypeButton",
      label: "Submit",
      name: "Submit",
      value: "",
      bounds: { x: 100, y: 200, width: 200, height: 50 },
      enabled: true,
      visible: true,
      selected: false,
      locatorCandidates: [
        {
          strategy: "xpath",
          selector: "//XCUIElementTypeButton[1]",
          confidence: 0.9,
        },
      ],
      possibleActions: ["tap"],
      source: "accessibility",
      confidence: 1.0,
    };

    const childText: UIElement = {
      elementId: "elem_1",
      semanticId: "StaticText::submit::12_21",
      type: "XCUIElementTypeStaticText",
      label: "Submit",
      name: "Submit",
      value: "Submit",
      bounds: { x: 120, y: 210, width: 160, height: 30 },
      enabled: true,
      visible: true,
      selected: false,
      locatorCandidates: [
        {
          strategy: "xpath",
          selector: "//XCUIElementTypeButton[1]/XCUIElementTypeStaticText[1]",
          confidence: 0.7,
        },
      ],
      possibleActions: ["tap"], // artificially marked tappable
      source: "accessibility",
      confidence: 1.0,
    };

    const interactive = filterInteractiveElements([parentButton, childText], {
      viewport,
    });

    // Child text is geometrically contained inside button and should be pruned
    expect(interactive.length).toBe(1);
    expect(interactive[0]?.type).toBe("XCUIElementTypeButton");
    expect(interactive[0]?.elementId).toBe("elem_0");
  });
});
