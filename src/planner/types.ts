import type { PlannedAction, UIElement } from "../types/contracts.js";

export interface PlanContext {
  pageId: string;
  elements: UIElement[];
  interactiveElements: UIElement[];
  visitedActionKeys: string[];
  pendingActionKeys: string[];
  screenshotPath?: string | undefined;
  depth: number;
  maxDepth: number;
  goal?: string | undefined;
  actionHistory?:
    Array<{ action: string; target?: string | undefined; reason?: string | undefined }> | undefined;
}

export interface Planner {
  planNextAction(context: PlanContext): Promise<PlannedAction>;
}
