import type { PlanContext } from "./types.js";

export function buildPlannerPrompt(context: PlanContext): string {
  const elementsSummary = context.interactiveElements.slice(0, 50).map((el) => ({
    id: el.elementId,
    semanticId: el.semanticId,
    type: el.type,
    label: el.label,
    name: el.name,
    actions: el.possibleActions,
    bounds: el.bounds,
  }));

  const payload = {
    task: "Plan the next safe, single exploration action on this iOS application screen.",
    currentPageId: context.pageId,
    currentDepth: context.depth,
    maxDepth: context.maxDepth,
    screenshotPath: context.screenshotPath ?? null,
    visitedActionsCount: context.visitedActionKeys.length,
    interactiveElementsCount: context.interactiveElements.length,
    availableElements: elementsSummary,
    instructions: [
      "Select exactly ONE action from: tap, type, scroll, back, dismiss_keyboard, stop.",
      "Never select dangerous operations (purchase, payment, delete, private key, transfer).",
      "Prioritize exploring novel, unvisited views and tabs.",
      "Return valid JSON matching the required schema.",
    ],
  };

  return JSON.stringify(payload, null, 2);
}
