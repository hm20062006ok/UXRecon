import type { ElementBounds, UIElement, Viewport } from "../types/contracts.js";
import type { RawXmlNode } from "./xml-parser.js";

export interface FilterInteractiveOptions {
  viewport?: Viewport | undefined;
  tree?: RawXmlNode | undefined;
  /** Minimum width and height for an element to be considered interactive. Default: 5 */
  minDimension?: number | undefined;
}

/**
 * Structural container types that are purely organizational and never direct tap targets.
 */
const SYSTEM_OR_CONTAINER_TYPES = new Set([
  "XCUIElementTypeApplication",
  "XCUIElementTypeWindow",
  "XCUIElementTypeStatusBar",
  "XCUIElementTypeOther",
]);

/**
 * High-priority interactive container types whose internal text/image children
 * should NOT be extracted as separate, duplicate interactive targets.
 */
const INTERACTIVE_CONTAINER_TYPES = new Set([
  "XCUIElementTypeButton",
  "XCUIElementTypeCell",
  "XCUIElementTypeLink",
  "XCUIElementTypeSegmentedControl",
  "XCUIElementTypeSwitch",
  "XCUIElementTypeSlider",
  "XCUIElementTypePickerWheel",
]);

/**
 * Checks whether an element bounds falls reasonably within the visible screen area.
 */
export function isBoundsOnScreen(bounds: ElementBounds, viewport?: Viewport, minDimension = 5): boolean {
  if (bounds.width < minDimension || bounds.height < minDimension) {
    return false;
  }

  // Must not start way offscreen to the left or top
  if (bounds.x < -1 || bounds.y < -1) {
    return false;
  }

  if (viewport) {
    if (bounds.x >= viewport.width || bounds.y >= viewport.height) {
      return false;
    }
  }

  return true;
}

/**
 * Checks whether container bounds geometrically envelops target bounds
 * with a tolerance of a few pixels.
 */
function geometricallyContains(container: ElementBounds, child: ElementBounds, tolerance = 2): boolean {
  return (
    child.x >= container.x - tolerance &&
    child.y >= container.y - tolerance &&
    child.x + child.width <= container.x + container.width + tolerance &&
    child.y + child.height <= container.y + container.height + tolerance
  );
}

/**
 * Calculates Intersection over Union (IoU) between two bounds.
 */
function calculateIoU(a: ElementBounds, b: ElementBounds): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  const intersectionW = Math.max(0, x2 - x1);
  const intersectionH = Math.max(0, y2 - y1);
  const intersectionArea = intersectionW * intersectionH;

  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const unionArea = areaA + areaB - intersectionArea;

  if (unionArea <= 0) return 0;
  return intersectionArea / unionArea;
}

/**
 * Collects a set of XPaths for nodes that reside inside an interactive ancestor node
 * (e.g. text/image inside a Button or Cell).
 */
function findChildXPathsInsideInteractiveContainers(tree: RawXmlNode): Set<string> {
  const suppressedXPaths = new Set<string>();

  function walk(node: RawXmlNode, insideInteractiveParent: boolean) {
    const isInteractiveContainer = INTERACTIVE_CONTAINER_TYPES.has(node.type);

    if (insideInteractiveParent) {
      suppressedXPaths.add(node.xpath);
    }

    const nextInside = insideInteractiveParent || isInteractiveContainer;
    for (const child of node.children) {
      walk(child, nextInside);
    }
  }

  for (const child of tree.children) {
    walk(child, false);
  }

  return suppressedXPaths;
}

/**
 * Filters the raw list of UIElements to produce the candidate interactive elements list:
 * - Omits invisible elements
 * - Omits disabled elements
 * - Omits zero-dimension or sub-threshold dimension elements
 * - Omits off-screen elements outside the viewport
 * - Omits pure decorative containers (Window, Application, StatusBar, XCUIElementTypeOther)
 * - Omits elements with no possible actions
 * - Deduplicates elements where a child text/icon is contained within an interactive button/cell
 */
export function filterInteractiveElements(
  elements: UIElement[],
  options?: FilterInteractiveOptions,
): UIElement[] {
  const minDim = options?.minDimension ?? 5;
  const viewport = options?.viewport;

  // 1. Basic viability filter
  const viable = elements.filter((element) => {
    if (!element.visible || !element.enabled) {
      return false;
    }

    if (element.possibleActions.length === 0) {
      return false;
    }

    if (SYSTEM_OR_CONTAINER_TYPES.has(element.type)) {
      return false;
    }

    if (!isBoundsOnScreen(element.bounds, viewport, minDim)) {
      return false;
    }

    return true;
  });

  // 2. Tree-based hierarchy suppression if tree is provided
  let filtered = viable;
  if (options?.tree) {
    const suppressedXPaths = findChildXPathsInsideInteractiveContainers(options.tree);
    filtered = viable.filter((element) => {
      // Find matching xpath candidate
      const xpathCandidate = element.locatorCandidates.find((c) => c.strategy === "xpath");
      if (xpathCandidate) {
        // If element is a child inside an interactive container, prune it
        for (const suppressed of suppressedXPaths) {
          if (xpathCandidate.selector.includes(suppressed)) {
            return false;
          }
        }
      }
      return true;
    });
  }

  // 3. Geometric deduplication:
  // If an interactive container (e.g. Button/Cell) geometrically envelops another element,
  // or if two elements have near-identical bounds (IoU > 0.85),
  // retain the higher-priority control (Button/Cell > Text/Image).
  const result: UIElement[] = [];

  for (let i = 0; i < filtered.length; i++) {
    const current = filtered[i]!;
    let isDuplicate = false;

    for (let j = 0; j < filtered.length; j++) {
      if (i === j) continue;
      const other = filtered[j]!;

      // If other is an interactive container and either:
      // (a) geometrically contains current, or
      // (b) has near-identical bounds (IoU > 0.85) and higher specificity
      if (INTERACTIVE_CONTAINER_TYPES.has(other.type)) {
        if (!INTERACTIVE_CONTAINER_TYPES.has(current.type)) {
          if (geometricallyContains(other.bounds, current.bounds)) {
            isDuplicate = true;
            break;
          }
        } else if (calculateIoU(current.bounds, other.bounds) > 0.85) {
          // If both are interactive containers with nearly identical bounds, pick the first one deterministically
          if (i > j) {
            isDuplicate = true;
            break;
          }
        }
      }
    }

    if (!isDuplicate) {
      result.push(current);
    }
  }

  return result;
}
