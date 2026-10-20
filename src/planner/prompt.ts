import type { PlanContext } from "./types.js";

export function buildPlannerPrompt(context: PlanContext): string {
  const elementsSummary = context.interactiveElements.slice(0, 60).map((el) => ({
    id: el.elementId,
    semanticId: el.semanticId,
    type: el.type,
    label: el.label || el.name || el.value || "(no text)",
    actions: el.possibleActions,
    bounds: el.bounds,
  }));

  const payload = {
    role: "You are an autonomous iOS UX exploration & reverse-engineering agent. Your job is to explore the app to extract every interaction, visual state, and screen structure so another AI agent can replicate the application perfectly.",
    userGoal:
      context.goal ??
      "Explore the application's key views and interactions thoroughly to reverse-engineer its complete UX and data flows.",
    currentPageId: context.pageId,
    currentDepth: context.depth,
    maxDepth: context.maxDepth,
    screenshotPath: context.screenshotPath ?? null,
    actionHistory: context.actionHistory ?? [],
    visitedActionsCount: context.visitedActionKeys.length,
    interactiveElementsCount: context.interactiveElements.length,
    availableElements: elementsSummary,
    instructions: [
      "1. Prioritize userGoal: If the goal specifies navigating to a section (e.g. '点击 Assets -- I don't have a wallet'), find that element and tap it first.",
      "2. Once inside the target flow/page, systematically explore its interactive buttons, tabs, input fields, and options to capture the complete UX specification.",
      "3. Provide 'agentThought' detailing your strategic reasoning and understanding of the current state towards the userGoal.",
      "4. Provide 'screenDescription' concisely describing what this screen does and its visual components.",
      "5. Specify 'targetElementId' or 'targetSemanticId' from availableElements and explain 'reason' and 'expectedEffect'.",
      "6. Allowed action kinds: 'tap', 'type', 'clear', 'scroll', 'back', 'dismiss_keyboard', 'stop'.",
      "7. When the userGoal has been fully fulfilled and all key interactions on target pages are documented, return kind: 'stop' with a descriptive reason.",
      "8. Return ONLY valid JSON matching the schema.",
    ],
  };

  return JSON.stringify(payload, null, 2);
}
