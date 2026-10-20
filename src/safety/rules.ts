import type { SafetyConfig } from "../config/types.js";
import type { PlannedAction, UIElement } from "../types/contracts.js";
import type { SafetyEvaluationResult } from "./types.js";

/**
 * Safety rules engine.
 *
 * NOTE: All default restrictions (Section 7.1 default-deny and 7.2 must-confirm:
 * payment, delete, transfer, messaging, password change, recovery phrases,
 * login, form input, permissions, coordinate taps, etc.) have been removed.
 *
 * Actions are permitted by default unless:
 * 1. The planner explicitly marks the action as `risk: "forbidden"`.
 * 2. The user explicitly specifies custom denyKeywords or confirmKeywords in config.
 */
export class SafetyRulesEngine {
  private readonly config: SafetyConfig;

  constructor(config: SafetyConfig) {
    this.config = config;
  }

  evaluate(action: PlannedAction, target?: UIElement): SafetyEvaluationResult {
    // 1. Explicit forbidden risk declaration from planner
    if (action.risk === "forbidden") {
      return {
        decision: "forbidden",
        matchedRules: ["planner.risk.forbidden"],
        reason: `Planner flagged action as forbidden: ${action.reason}`,
      };
    }

    // 2. Check user-configured explicit deny keywords or confirm keywords
    if (target || action.inputText || action.inputPurpose) {
      const texts = [
        target?.label,
        target?.name,
        target?.value,
        action.inputText ?? "",
        action.inputPurpose ?? "",
      ].filter(Boolean);

      const combinedText = texts.join(" ").toLowerCase();

      // Check configured deny keywords
      for (const keyword of this.config.denyKeywords) {
        const lower = keyword.trim().toLowerCase();
        if (lower && combinedText.includes(lower)) {
          return {
            decision: "deny",
            matchedRules: [`deny.keyword.${lower}`],
            reason: `Target text matches explicitly configured deny keyword: "${keyword}"`,
          };
        }
      }

      // Check configured confirm keywords
      for (const keyword of this.config.confirmKeywords) {
        const lower = keyword.trim().toLowerCase();
        if (lower && combinedText.includes(lower)) {
          return {
            decision: "confirm",
            matchedRules: [`confirm.keyword.${lower}`],
            reason: `Target text matches explicitly configured confirm keyword: "${keyword}"`,
          };
        }
      }
    }

    // Default to allow: all default-deny and must-confirm restrictions removed
    return {
      decision: "allow",
      matchedRules: ["default.allow"],
      reason: "Action permitted under unrestricted exploration policy.",
    };
  }
}
