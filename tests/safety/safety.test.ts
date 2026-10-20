import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIRM_KEYWORDS, DEFAULT_DENY_KEYWORDS } from "../../src/config/schema.js";
import { BoundaryGuard, defaultRejectConfirmHandler, SafetyRulesEngine } from "../../src/safety/index.js";
import type { PlannedAction, UIElement } from "../../src/types/contracts.js";

const DEFAULT_SAFETY_CONFIG = {
  allowSafeTap: true,
  denyKeywords: [...DEFAULT_DENY_KEYWORDS],
  confirmKeywords: [...DEFAULT_CONFIRM_KEYWORDS],
  redactPatterns: [],
};

function makeElement(overrides: Partial<UIElement> = {}): UIElement {
  return {
    elementId: "el-1",
    semanticId: "btn-submit",
    type: "XCUIElementTypeButton",
    label: "Submit",
    name: "submit",
    value: "",
    bounds: { x: 10, y: 10, width: 100, height: 40 },
    enabled: true,
    visible: true,
    selected: false,
    locatorCandidates: [],
    possibleActions: ["tap"],
    source: "accessibility",
    confidence: 1.0,
    ...overrides,
  };
}

describe("SafetyRulesEngine (Unrestricted Policy)", () => {
  const engine = new SafetyRulesEngine(DEFAULT_SAFETY_CONFIG);

  it("permits navigation actions like scroll, back, and dismiss keyboard", () => {
    const scrollAction: PlannedAction = {
      kind: "scroll",
      reason: "Inspect further down",
      expectedEffect: "View reveals more items",
      risk: "low",
      confidence: 1.0,
    };
    expect(engine.evaluate(scrollAction).decision).toBe("allow");

    const backAction: PlannedAction = {
      kind: "back",
      reason: "Return to previous screen",
      expectedEffect: "Pops navigation stack",
      risk: "low",
      confidence: 1.0,
    };
    expect(engine.evaluate(backAction).decision).toBe("allow");
  });

  it("permits actions that previously matched 7.1 default-deny (transfer, delete, pay, mnemonic)", () => {
    const formerlyRestrictedElements = [
      makeElement({ label: "Delete Account", name: "btn_delete" }),
      makeElement({ label: "Transfer Funds", name: "send_money" }),
      makeElement({ label: "Export Private Key", name: "export_key" }),
      makeElement({ label: "Mnemonic Backup", name: "seed_phrase" }),
      makeElement({ label: "确认支付", name: "pay" }),
      makeElement({ label: "删除钱包", name: "del_wallet" }),
    ];

    for (const target of formerlyRestrictedElements) {
      const action: PlannedAction = {
        kind: "tap",
        targetElementId: target.elementId,
        reason: "Test click",
        expectedEffect: "interact",
        risk: "low",
        confidence: 0.9,
      };
      const evaluation = engine.evaluate(action, target);
      expect(evaluation.decision).toBe("allow");
    }
  });

  it("permits actions that previously matched 7.2 must-confirm (login, auth, permissions, form typing)", () => {
    const formerlyConfirmElements = [
      makeElement({ label: "Log In", name: "login_btn" }),
      makeElement({ label: "Sign in with Apple", name: "apple_signin" }),
      makeElement({ label: "Connect Wallet", name: "connect_btn" }),
      makeElement({ label: "授权访问", name: "auth_btn" }),
      makeElement({ label: "Allow Permission", name: "allow_btn" }),
    ];

    for (const target of formerlyConfirmElements) {
      const action: PlannedAction = {
        kind: "tap",
        targetElementId: target.elementId,
        reason: "Login attempt",
        expectedEffect: "opens auth",
        risk: "low",
        confidence: 0.9,
      };
      const evaluation = engine.evaluate(action, target);
      expect(evaluation.decision).toBe("allow");
    }
  });

  it("permits typing into password and text input fields", () => {
    const secureInput = makeElement({
      type: "XCUIElementTypeSecureTextField",
      label: "Enter Password",
      name: "password_field",
    });

    const action: PlannedAction = {
      kind: "type",
      targetElementId: secureInput.elementId,
      inputText: "secret123",
      reason: "Fill credentials",
      expectedEffect: "input password",
      risk: "low",
      confidence: 0.9,
    };

    const evaluation = engine.evaluate(action, secureInput);
    expect(evaluation.decision).toBe("allow");
  });

  it("permits tapping coordinates even without target element or low confidence", () => {
    const blindTap: PlannedAction = {
      kind: "tap",
      reason: "Tap coordinates",
      expectedEffect: "click somewhere",
      risk: "low",
      confidence: 0.8,
    };
    expect(engine.evaluate(blindTap).decision).toBe("allow");

    const lowConfidenceTarget = makeElement({ confidence: 0.3 });
    expect(engine.evaluate(blindTap, lowConfidenceTarget).decision).toBe("allow");
  });

  it("still honors explicitly configured custom deny keywords and confirm keywords", () => {
    const customEngine = new SafetyRulesEngine({
      allowSafeTap: true,
      denyKeywords: ["custom_danger"],
      confirmKeywords: ["custom_confirm"],
      redactPatterns: [],
    });

    const denyTarget = makeElement({ label: "Contains custom_danger action" });
    const denyAction: PlannedAction = {
      kind: "tap",
      targetElementId: denyTarget.elementId,
      reason: "Custom test",
      expectedEffect: "test",
      risk: "low",
      confidence: 1.0,
    };
    expect(customEngine.evaluate(denyAction, denyTarget).decision).toBe("deny");

    const confirmTarget = makeElement({ label: "Contains custom_confirm action" });
    const confirmAction: PlannedAction = {
      kind: "tap",
      targetElementId: confirmTarget.elementId,
      reason: "Custom test",
      expectedEffect: "test",
      risk: "low",
      confidence: 1.0,
    };
    expect(customEngine.evaluate(confirmAction, confirmTarget).decision).toBe("confirm");
  });

  it("still honors explicit planner risk=forbidden", () => {
    const forbiddenAction: PlannedAction = {
      kind: "tap",
      reason: "Planner marked as forbidden",
      expectedEffect: "blocked",
      risk: "forbidden",
      confidence: 1.0,
    };
    expect(engine.evaluate(forbiddenAction).decision).toBe("forbidden");
  });
});

describe("BoundaryGuard (Unrestricted App Boundary)", () => {
  const guard = new BoundaryGuard("com.global.wallet.ios");

  it("allows actions when active app matches expected bundleId", () => {
    const check = guard.check("com.global.wallet.ios");
    expect(check.allowed).toBe(true);
    expect(check.actualBundleId).toBe("com.global.wallet.ios");
  });

  it("allows SpringBoard system alerts", () => {
    const check = guard.check("com.apple.springboard");
    expect(check.allowed).toBe(true);
  });

  it("allows navigation even when device navigates to another app", () => {
    const check = guard.check("com.apple.Preferences");
    expect(check.allowed).toBe(true);
    expect(check.actualBundleId).toBe("com.apple.Preferences");
  });
});

describe("ConfirmHandler", () => {
  it("defaultRejectConfirmHandler always rejects safely", async () => {
    const result = await defaultRejectConfirmHandler({
      action: {
        kind: "tap",
        reason: "Dangerous action",
        expectedEffect: "test",
        risk: "high",
        confidence: 0.8,
      },
      reason: "High risk test",
    });
    expect(result).toBe(false);
  });
});
