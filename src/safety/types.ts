import type { PlannedAction, UIElement } from "../types/contracts.js";

export type SafetyDecision = "allow" | "confirm" | "deny" | "forbidden";

export interface SafetyEvaluationResult {
  decision: SafetyDecision;
  matchedRules: string[];
  reason: string;
}

export interface ConfirmRequest {
  action: PlannedAction;
  target?: UIElement | undefined;
  screenshotPath?: string | undefined;
  reason: string;
}

export type ConfirmHandler = (request: ConfirmRequest) => Promise<boolean>;

export interface BoundaryCheckResult {
  allowed: boolean;
  expectedBundleId: string;
  actualBundleId: string;
  reason?: string | undefined;
}
