import type { ElementBounds } from "../types/contracts.js";

export interface ComponentSpec {
  id: string;
  semanticId: string;
  type: string;
  label: string;
  bounds: ElementBounds;
  provenance: "observed" | "estimated" | "unknown";
}

export interface ScreenSpec {
  schemaVersion: 1;
  pageId: string;
  title: string;
  viewport: { width: number; height: number };
  components: ComponentSpec[];
}

export interface DesignTokens {
  schemaVersion: 1;
  spacingScale: number[];
  commonSizes: { width: number; height: number }[];
  inferredRadii: number[];
}

export interface UxIssue {
  severity: "error" | "warning" | "info";
  ruleId: string;
  title: string;
  elementId?: string | undefined;
  detail: string;
  recommendation: string;
}

export interface UxAuditReport {
  schemaVersion: 1;
  pageId: string;
  score: number; // 0 - 100
  dimensions: {
    touchTargetSize: number;
    accessibilityLabels: number;
    visualHierarchy: number;
  };
  issues: UxIssue[];
}
