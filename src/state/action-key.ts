import type { ActionKind, PlannedAction } from "../types/contracts.js";

export interface ActionKeyParams {
  pageFingerprint: string;
  actionKind: ActionKind;
  targetSemanticId?: string | undefined;
  inputPurpose?: string | undefined;
  direction?: "up" | "down" | "left" | "right" | undefined;
}

/**
 * Generates a stable, reproducible action key for tracking page transitions
 * and avoiding redundant exploration loops.
 *
 * Format: `act_${pageFingerprint}:${actionKind}:${targetSemanticId || "screen"}:${extra}`
 */
export function generateActionKey(params: ActionKeyParams): string {
  const parts: string[] = [
    `act_${params.pageFingerprint}`,
    params.actionKind,
    params.targetSemanticId || "none",
  ];

  if (params.inputPurpose) {
    parts.push(params.inputPurpose);
  } else if (params.direction) {
    parts.push(params.direction);
  }

  return parts.join(":");
}

/**
 * Convenience helper to create an action key directly from a PlannedAction and page fingerprint.
 */
export function actionKeyFromPlannedAction(pageFingerprint: string, action: PlannedAction): string {
  return generateActionKey({
    pageFingerprint,
    actionKind: action.kind,
    targetSemanticId: action.targetSemanticId,
    inputPurpose: action.inputPurpose,
    direction: action.direction,
  });
}
