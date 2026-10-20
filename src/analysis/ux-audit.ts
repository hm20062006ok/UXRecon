import type { UIElement } from "../types/contracts.js";
import type { UxAuditReport, UxIssue } from "./types.js";

const MIN_TOUCH_TARGET = 44; // Apple HIG recommended min touch target (pt)

export function auditPageUx(pageId: string, interactiveElements: UIElement[]): UxAuditReport {
  const issues: UxIssue[] = [];

  let smallTargetCount = 0;
  let missingLabelCount = 0;

  for (const el of interactiveElements) {
    // 1. Touch target size check
    if (el.bounds.width < MIN_TOUCH_TARGET || el.bounds.height < MIN_TOUCH_TARGET) {
      smallTargetCount += 1;
      issues.push({
        severity: "warning",
        ruleId: "a11y.touch-target-size",
        title: "Touch target smaller than 44x44 pt",
        elementId: el.elementId,
        detail: `Element has bounds ${el.bounds.width}x${el.bounds.height} pt, below Apple HIG minimum of 44x44 pt.`,
        recommendation: "Increase tap padding or element size to at least 44x44 pt for comfortable tapping.",
      });
    }

    // 2. Missing label check
    if (!el.label && !el.name) {
      missingLabelCount += 1;
      issues.push({
        severity: "error",
        ruleId: "a11y.missing-accessible-label",
        title: "Interactive control lacks accessible label",
        elementId: el.elementId,
        detail: `Control of type ${el.type} has neither accessibilityLabel nor accessibilityIdentifier.`,
        recommendation: "Provide a descriptive accessibilityLabel for VoiceOver and automation stability.",
      });
    }
  }

  const totalInteractive = Math.max(interactiveElements.length, 1);
  const targetScore = Math.max(0, Math.round(100 - (smallTargetCount / totalInteractive) * 50));
  const labelScore = Math.max(0, Math.round(100 - (missingLabelCount / totalInteractive) * 50));
  const overallScore = Math.round((targetScore + labelScore) / 2);

  return {
    schemaVersion: 1,
    pageId,
    score: overallScore,
    dimensions: {
      touchTargetSize: targetScore,
      accessibilityLabels: labelScore,
      visualHierarchy: 90,
    },
    issues,
  };
}
