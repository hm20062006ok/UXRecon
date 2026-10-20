import type { PageState, UIElement, Viewport } from "../types/contracts.js";
import type { ScreenSpec } from "./types.js";

export function generateScreenSpec(
  pageState: PageState,
  elements: UIElement[],
  viewport: Viewport,
): ScreenSpec {
  const components = elements.map((el) => ({
    id: el.elementId,
    semanticId: el.semanticId,
    type: el.type,
    label: el.label || el.name,
    bounds: el.bounds,
    provenance: "observed" as const,
  }));

  return {
    schemaVersion: 1,
    pageId: pageState.pageId,
    title: pageState.pageId,
    viewport,
    components,
  };
}
