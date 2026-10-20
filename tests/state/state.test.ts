import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseElements } from "../../src/observation/index.js";
import {
  actionKeyFromPlannedAction,
  computePageFingerprints,
  computeSemanticId,
  generateActionKey,
  isVolatileText,
  StateRegistry,
} from "../../src/state/index.js";
import type { Observation, PlannedAction, Transition } from "../../src/types/contracts.js";

const ARTIFACTS_DIR = path.resolve(__dirname, "../../artifacts/p0-real-device-2026-10-20T05-46-44-165Z");

describe("P3-T3: Semantic IDs & Action Keys", () => {
  it("generates stable semantic IDs for UI elements", () => {
    const id1 = computeSemanticId({
      type: "XCUIElementTypeButton",
      name: "Market",
      bounds: { x: 88, y: 844, width: 81, height: 48 },
    });

    // Slight coordinate jitter of 2px should not change semanticId
    const id2 = computeSemanticId({
      type: "XCUIElementTypeButton",
      name: "Market",
      bounds: { x: 89, y: 843, width: 81, height: 48 },
    });

    expect(id1).toBe(id2);
    expect(id1).toContain("Button::market::");
  });

  it("sanitizes volatile texts into stable semantic tokens", () => {
    const idPrice = computeSemanticId({
      type: "XCUIElementTypeStaticText",
      value: "$1,234.56",
      bounds: { x: 50, y: 100, width: 80, height: 20 },
    });
    expect(idPrice).toContain("StaticText::currency_val::");

    const idPct = computeSemanticId({
      type: "XCUIElementTypeStaticText",
      value: "+180.94%",
      bounds: { x: 50, y: 100, width: 80, height: 20 },
    });
    expect(idPct).toContain("StaticText::pct_val::");

    const idCrypto = computeSemanticId({
      type: "XCUIElementTypeStaticText",
      value: "0.543 ETH",
      bounds: { x: 50, y: 100, width: 80, height: 20 },
    });
    expect(idCrypto).toContain("StaticText::crypto_val::");
  });

  it("generates structured and collision-free action keys", () => {
    const key = generateActionKey({
      pageFingerprint: "struct_1234",
      actionKind: "tap",
      targetSemanticId: "Button::market::4_42",
    });
    expect(key).toBe("act_struct_1234:tap:Button::market::4_42");

    const plannedAction: PlannedAction = {
      kind: "type",
      targetSemanticId: "TextField::search::1_3",
      inputPurpose: "search_symbol",
      reason: "Search for token",
      expectedEffect: "List filtered tokens",
      risk: "low",
      confidence: 0.9,
    };
    const plannedKey = actionKeyFromPlannedAction("struct_1234", plannedAction);
    expect(plannedKey).toBe("act_struct_1234:type:TextField::search::1_3:search_symbol");
  });
});

describe("P3-T4: Page Fingerprints", () => {
  it("detects volatile texts correctly", () => {
    expect(isVolatileText("+180.94%")).toBe(true);
    expect(isVolatileText("-2.67%")).toBe(true);
    expect(isVolatileText("$12.34")).toBe(true);
    expect(isVolatileText("¥99.00")).toBe(true);
    expect(isVolatileText("14:32")).toBe(true);
    expect(isVolatileText("09:41 AM")).toBe(true);
    expect(isVolatileText("2026-10-20")).toBe(true);
    expect(isVolatileText("0x1234abcd5678")).toBe(true);
    expect(isVolatileText("(3)")).toBe(true);

    expect(isVolatileText("Market")).toBe(false);
    expect(isVolatileText("Assets")).toBe(false);
    expect(isVolatileText("Discover")).toBe(false);
    expect(isVolatileText("Enter token symbol or contract to search")).toBe(false);
  });

  it("computes distinct fingerprints between different pages in real device artifacts", async () => {
    const initialXml = await readFile(path.join(ARTIFACTS_DIR, "000-initial.xml"), "utf8");
    const marketXml = await readFile(path.join(ARTIFACTS_DIR, "it-01-after.xml"), "utf8");

    const initialElements = parseElements(initialXml);
    const marketElements = parseElements(marketXml);

    const initialFp = computePageFingerprints(initialElements);
    const marketFp = computePageFingerprints(marketElements);

    // Initial page and Market page must differ in both exact and structural fingerprints
    expect(initialFp.exact).not.toBe(marketFp.exact);
    expect(initialFp.structural).not.toBe(marketFp.structural);
  });

  it("preserves structural fingerprint across market iterations despite volatile price changes", async () => {
    const it1Xml = await readFile(path.join(ARTIFACTS_DIR, "it-01-after.xml"), "utf8");
    const it2Xml = await readFile(path.join(ARTIFACTS_DIR, "it-02-after.xml"), "utf8");

    const it1Elements = parseElements(it1Xml);
    const it2Elements = parseElements(it2Xml);

    const fp1 = computePageFingerprints(it1Elements);
    const fp2 = computePageFingerprints(it2Elements);

    // Structural skeleton is identical because volatile price percentages are normalized
    expect(fp1.structural).toBe(fp2.structural);
  });

  it("matches restore page fingerprint with original before page", async () => {
    const beforeXml = await readFile(path.join(ARTIFACTS_DIR, "it-01-before.xml"), "utf8");
    const restoreXml = await readFile(path.join(ARTIFACTS_DIR, "it-01-restore-a1.xml"), "utf8");

    const beforeElements = parseElements(beforeXml);
    const restoreElements = parseElements(restoreXml);

    const beforeFp = computePageFingerprints(beforeElements);
    const restoreFp = computePageFingerprints(restoreElements);

    expect(restoreFp.structural).toBe(beforeFp.structural);
    expect(restoreFp.exact).toBe(beforeFp.exact);
  });
});

describe("P3-T5: StateRegistry & Navigation Graph", () => {
  function makeMockObservation(id: string, timestamp: string): Observation {
    return {
      schemaVersion: 1,
      observationId: id,
      capturedAt: timestamp,
      screenshotPath: `/tmp/${id}.png`,
      pageSourcePath: `/tmp/${id}.xml`,
      appId: "com.global.wallet.ios",
      orientation: "PORTRAIT",
      viewport: { width: 428, height: 926 },
      elements: [],
      keyboardVisible: false,
      systemAlert: false,
      captureWarnings: [],
    };
  }

  it("registers observations, detects new vs known pages, and updates lastVisitedAt", async () => {
    const registry = new StateRegistry();

    const initialXml = await readFile(path.join(ARTIFACTS_DIR, "000-initial.xml"), "utf8");
    const initialElements = parseElements(initialXml);
    const obs1 = makeMockObservation("obs_1", "2026-10-20T10:00:00.000Z");

    const page1 = registry.registerObservation(obs1, initialElements, initialElements);
    expect(page1.status).toBe("new");
    expect(page1.firstSeenAt).toBe("2026-10-20T10:00:00.000Z");
    expect(page1.lastVisitedAt).toBe("2026-10-20T10:00:00.000Z");
    expect(page1.pendingActionKeys.length).toBeGreaterThan(0);

    // Registering the exact same page again updates lastVisitedAt and returns same pageId
    const obs2 = makeMockObservation("obs_2", "2026-10-20T10:05:00.000Z");
    const page2 = registry.registerObservation(obs2, initialElements, initialElements);
    expect(page2.pageId).toBe(page1.pageId);
    expect(page2.lastVisitedAt).toBe("2026-10-20T10:05:00.000Z");

    // Registering Market page creates a new PageState
    const marketXml = await readFile(path.join(ARTIFACTS_DIR, "it-01-after.xml"), "utf8");
    const marketElements = parseElements(marketXml);
    const obs3 = makeMockObservation("obs_3", "2026-10-20T10:06:00.000Z");

    const pageMarket = registry.registerObservation(obs3, marketElements, marketElements);
    expect(pageMarket.pageId).not.toBe(page1.pageId);
    expect(pageMarket.status).toBe("new");

    // Registering Market second iteration (it-02-after.xml) recognizes structural match!
    const market2Xml = await readFile(path.join(ARTIFACTS_DIR, "it-02-after.xml"), "utf8");
    const market2Elements = parseElements(market2Xml);
    const obs4 = makeMockObservation("obs_4", "2026-10-20T10:07:00.000Z");

    const pageMarket2 = registry.registerObservation(obs4, market2Elements, market2Elements);
    expect(pageMarket2.pageId).toBe(pageMarket.pageId);
    expect(pageMarket2.lastVisitedAt).toBe("2026-10-20T10:07:00.000Z");
  });

  it("records transitions and maintains navigation graph", async () => {
    const registry = new StateRegistry();

    const initialXml = await readFile(path.join(ARTIFACTS_DIR, "000-initial.xml"), "utf8");
    const initialElements = parseElements(initialXml);
    const marketXml = await readFile(path.join(ARTIFACTS_DIR, "it-01-after.xml"), "utf8");
    const marketElements = parseElements(marketXml);

    const pageHome = registry.registerObservation(
      makeMockObservation("obs_home", "2026-10-20T10:00:00Z"),
      initialElements,
      initialElements,
    );
    const pageMarket = registry.registerObservation(
      makeMockObservation("obs_market", "2026-10-20T10:01:00Z"),
      marketElements,
      marketElements,
    );

    const actionKey = pageHome.pendingActionKeys[0]!;

    const transition: Transition = {
      transitionId: "trans_1",
      fromPageId: pageHome.pageId,
      toPageId: pageMarket.pageId,
      action: {
        kind: "tap",
        targetSemanticId: "Button::market::4_42",
        reason: "Navigate to market",
        expectedEffect: "Open market tab",
        risk: "low",
        confidence: 0.95,
      },
      actionKey,
      beforeObservationId: "obs_home",
      afterObservationId: "obs_market",
      startedAt: "2026-10-20T10:00:30Z",
      durationMs: 1200,
      result: "changed",
      uxObservations: ["Switched to Market tab"],
    };

    registry.recordTransition(transition);

    // fromPage pending/visited action state updated
    expect(pageHome.visitedActionKeys).toContain(actionKey);
    expect(pageHome.pendingActionKeys).not.toContain(actionKey);
    expect(pageHome.status).toBe("exploring");

    // toPage parent transition recorded
    expect(pageMarket.parentTransitionId).toBe("trans_1");

    // Adjacency graph
    const adjacency = registry.getAdjacencyList();
    expect(adjacency[pageHome.pageId]).toContain(pageMarket.pageId);

    const transitions = registry.getOutgoingTransitions(pageHome.pageId);
    expect(transitions.length).toBe(1);
    expect(transitions[0]?.transitionId).toBe("trans_1");
  });

  it("atomically saves and restores state registry checkpoints", async () => {
    const registry = new StateRegistry();
    const initialXml = await readFile(path.join(ARTIFACTS_DIR, "000-initial.xml"), "utf8");
    const initialElements = parseElements(initialXml);

    const page = registry.registerObservation(
      makeMockObservation("obs_1", "2026-10-20T10:00:00Z"),
      initialElements,
      initialElements,
    );

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "uxr-state-test-"));
    try {
      await registry.save(tempDir);

      // Verify files written
      const cpRaw = await readFile(path.join(tempDir, "checkpoint.json"), "utf8");
      const graphRaw = await readFile(path.join(tempDir, "navigation-graph.json"), "utf8");
      expect(JSON.parse(cpRaw)).toBeDefined();
      expect(JSON.parse(graphRaw)).toBeDefined();

      // Load into a new registry instance
      const restoredRegistry = new StateRegistry();
      await restoredRegistry.load(tempDir);

      expect(restoredRegistry.getAllPages().length).toBe(1);
      const restoredPage = restoredRegistry.getPage(page.pageId);
      expect(restoredPage).toBeDefined();
      expect(restoredPage?.fingerprints.structural).toBe(page.fingerprints.structural);

      // Fast lookup by fingerprint still works after restore
      const found = restoredRegistry.findPageByFingerprint({
        structural: page.fingerprints.structural,
      });
      expect(found?.pageId).toBe(page.pageId);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
