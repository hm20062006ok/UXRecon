import type { UIElement } from "../types/contracts.js";
import type { DesignTokens } from "./types.js";

export function extractDesignTokens(elements: UIElement[]): DesignTokens {
  const widths = new Set<number>();
  const heights = new Set<number>();

  for (const el of elements) {
    if (el.bounds.width > 0 && el.bounds.height > 0) {
      widths.add(Math.round(el.bounds.width));
      heights.add(Math.round(el.bounds.height));
    }
  }

  // Common iOS standard spacing intervals
  const spacingScale = [4, 8, 12, 16, 20, 24, 32, 40, 48];
  const inferredRadii = [8, 12, 16, 20, 24];

  const commonSizes: { width: number; height: number }[] = [];
  for (const w of Array.from(widths).slice(0, 10)) {
    for (const h of Array.from(heights).slice(0, 5)) {
      commonSizes.push({ width: w, height: h });
    }
  }

  return {
    schemaVersion: 1,
    spacingScale,
    commonSizes: commonSizes.slice(0, 15),
    inferredRadii,
  };
}
