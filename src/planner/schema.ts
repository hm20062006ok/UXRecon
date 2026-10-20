import { z } from "zod";
import type { PlannedAction } from "../types/contracts.js";

const actionKindSchema = z.enum([
  "tap",
  "type",
  "clear",
  "scroll",
  "back",
  "dismiss_keyboard",
  "handle_alert",
  "ask_user",
  "stop",
]);

const actionRiskSchema = z.enum(["low", "medium", "high", "forbidden"]);

export const plannedActionSchema = z.strictObject({
  kind: actionKindSchema,
  targetElementId: z.string().optional(),
  targetSemanticId: z.string().optional(),
  inputText: z.string().optional(),
  inputPurpose: z.string().optional(),
  direction: z.enum(["up", "down", "left", "right"]).optional(),
  reason: z.string().min(1, "reason must explain why this action was selected"),
  expectedEffect: z.string().min(1, "expectedEffect must state the predicted screen change"),
  risk: actionRiskSchema.default("low"),
  confidence: z.number().min(0).max(1).default(1.0),
});

export function parsePlannedAction(rawJson: unknown): PlannedAction {
  if (rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)) {
    const raw = rawJson as Record<string, unknown>;
    const normalized: Record<string, unknown> = { ...raw };

    if (!normalized.kind && typeof normalized.action === "string") {
      normalized.kind = normalized.action;
      delete normalized.action;
    }
    if (!normalized.targetElementId && typeof normalized.elementId === "string") {
      normalized.targetElementId = normalized.elementId;
      delete normalized.elementId;
    }
    if (!normalized.expectedEffect) {
      if (typeof normalized.expected_effect === "string") {
        normalized.expectedEffect = normalized.expected_effect;
        delete normalized.expected_effect;
      } else {
        normalized.expectedEffect =
          typeof normalized.reason === "string" ? normalized.reason : "Screen state transition";
      }
    }
    if (!normalized.reason) {
      normalized.reason = "Explore accessible interaction element";
    }

    return plannedActionSchema.parse(normalized);
  }

  return plannedActionSchema.parse(rawJson);
}
