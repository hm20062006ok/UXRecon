import type { PlannedAction, UIElement } from "../types/contracts.js";
import type { PlanContext, Planner } from "./types.js";

export class DeterministicPlanner implements Planner {
  planNextAction(context: PlanContext): Promise<PlannedAction> {
    // 1. If we reached max depth, safely return
    if (context.depth >= context.maxDepth) {
      return Promise.resolve({
        kind: "back",
        reason: `Reached maximum exploration depth (${context.depth}/${context.maxDepth}). Returning to parent page.`,
        expectedEffect: "Pops back to parent screen",
        risk: "low",
        confidence: 1.0,
      });
    }

    // 2. Find an unvisited interactive element
    const unvisitedElement = this.pickNextInteractiveElement(
      context.interactiveElements,
      context.visitedActionKeys,
    );

    if (unvisitedElement) {
      const preferredAction = unvisitedElement.possibleActions[0] ?? "tap";
      return Promise.resolve({
        kind: preferredAction,
        targetElementId: unvisitedElement.elementId,
        targetSemanticId: unvisitedElement.semanticId,
        reason: `Deterministic exploration of unvisited interactive element: [${unvisitedElement.type}] "${unvisitedElement.label || unvisitedElement.name}"`,
        expectedEffect: `Triggers ${preferredAction} on ${unvisitedElement.semanticId}`,
        risk: "low",
        confidence: 0.9,
      });
    }

    // 3. No unvisited elements on this page. If we are deep, go back; otherwise stop
    if (context.depth > 0) {
      return Promise.resolve({
        kind: "back",
        reason: "All interactive elements on this page have been explored. Backtracking to parent.",
        expectedEffect: "Returns to previous page in navigation stack",
        risk: "low",
        confidence: 1.0,
      });
    }

    return Promise.resolve({
      kind: "stop",
      reason: "All discoverable interactive elements explored on root page. Completed traversal.",
      expectedEffect: "Concludes exploration run",
      risk: "low",
      confidence: 1.0,
    });
  }

  private pickNextInteractiveElement(
    candidates: UIElement[],
    visitedActionKeys: string[],
  ): UIElement | undefined {
    for (const element of candidates) {
      // Check if any visited action key contains this element's semantic ID
      const alreadyVisited = visitedActionKeys.some((key) => key.includes(element.semanticId));
      if (!alreadyVisited) {
        return element;
      }
    }
    return undefined;
  }
}
