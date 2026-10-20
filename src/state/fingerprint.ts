import { createHash } from "node:crypto";
import type { ElementBounds, PageFingerprints, UIElement, Viewport } from "../types/contracts.js";
import { getShortElementType } from "./semantic-id.js";

export interface FingerprintOptions {
  viewport?: Viewport | undefined;
  keyboardVisible?: boolean | undefined;
  systemAlert?: boolean | undefined;
  visualHash?: string | undefined;
}

const CONTROL_TYPES = new Set([
  "XCUIElementTypeButton",
  "XCUIElementTypeCell",
  "XCUIElementTypeStaticText",
  "XCUIElementTypeTextField",
  "XCUIElementTypeSecureTextField",
  "XCUIElementTypeSearchField",
  "XCUIElementTypeSwitch",
  "XCUIElementTypeSlider",
  "XCUIElementTypeSegmentedControl",
  "XCUIElementTypeLink",
  "XCUIElementTypeImage",
  "XCUIElementTypeTabBar",
  "XCUIElementTypeNavigationBar",
  "XCUIElementTypePickerWheel",
]);

const VOLATILE_PATTERNS = [
  // Percentage: +180.94%, -2.67%, 50%
  /^[+-]?\d+(?:\.\d+)?%$/,
  // Currency: $12.34, ¥100, €5.50
  /^[$€£¥]\s*[\d,]+(?:\.\d+)?$/,
  // Crypto quantities: 0.0543 ETH, 100 BTC
  /^[\d,]+(?:\.\d+)?\s*(?:BTC|ETH|USDT|USDC|BNB|SOL)$/i,
  // Time: 14:32, 09:41:20 AM, 5m ago, Just now
  /^\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?$|^\d+\s*(?:m|s|h|d)\s*ago$/i,
  // Dates: 2026-10-20, 10/20/2026, Oct 20
  /^\d{4}[-/]\d{2}[-/]\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
  // Hex addresses or hashes: 0x1234...5678
  /^0x[a-fA-F0-9]{4,}$/,
  // Pure numbers, counts, balances
  /^[\d.,+-]+$/,
  // Dynamic counter badges: (3), [99+]
  /^[([{\u3010]\d+\+?[)\]}\u3011]$/,
];

/**
 * Checks whether text matches any volatile pattern (numbers, prices, timestamps, percentages).
 */
export function isVolatileText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return VOLATILE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Normalizes text for structural comparison.
 * If text is volatile (e.g. price, percentage, time), replaces it with a generic marker.
 */
export function normalizeStructuralText(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) return "";

  if (isVolatileText(trimmed)) {
    return "<VOLATILE>";
  }

  // Strip volatile embedded numbers/percentages while keeping structural words
  return trimmed
    .replace(/[+-]?\d+(?:\.\d+)?%/g, "<PCT>")
    .replace(/[$€£¥]\s*[\d,]+(?:\.\d+)?/g, "<CURR>")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "<TIME>")
    .replace(/\b\d+\b/g, "<NUM>")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks if element is visible and within bounds.
 */
function isElementOnScreen(element: UIElement, viewport?: Viewport): boolean {
  if (!element.visible || element.bounds.width <= 0 || element.bounds.height <= 0) {
    return false;
  }

  if (element.bounds.x < -1 || element.bounds.y < -1) {
    return false;
  }

  if (viewport) {
    if (element.bounds.x >= viewport.width || element.bounds.y >= viewport.height) {
      return false;
    }
  }

  return true;
}

/**
 * Anonymous layout containers (XCUIElementTypeOther with no name/label) shift
 * by points between visually identical states and do not participate in fingerprinting.
 */
function isFingerprintRelevant(element: UIElement, viewport?: Viewport): boolean {
  if (!isElementOnScreen(element, viewport)) {
    return false;
  }

  if (element.type === "XCUIElementTypeStatusBar") {
    return false;
  }

  return (
    element.name.length > 0 ||
    element.label.length > 0 ||
    element.value.length > 0 ||
    CONTROL_TYPES.has(element.type)
  );
}

function hashTokens(tokens: string[]): string {
  const sorted = [...tokens].sort();
  return createHash("sha256").update(sorted.join("\n")).digest("hex").slice(0, 16);
}

/**
 * Computes both exact and structural fingerprints for a page observation.
 */
export function computePageFingerprints(
  elements: UIElement[],
  options?: FingerprintOptions,
): PageFingerprints {
  const viewport = options?.viewport;
  const exactTokens: string[] = [];
  const structuralTokens: string[] = [];

  // Include global states
  if (options?.keyboardVisible) {
    exactTokens.push("STATE|KEYBOARD|VISIBLE");
    structuralTokens.push("STATE|KEYBOARD|VISIBLE");
  }
  if (options?.systemAlert) {
    exactTokens.push("STATE|ALERT|VISIBLE");
    structuralTokens.push("STATE|ALERT|VISIBLE");
  }

  for (const element of elements) {
    if (!isFingerprintRelevant(element, viewport)) {
      continue;
    }

    const shortType = getShortElementType(element.type);
    const bounds: ElementBounds = element.bounds;

    // Exact fingerprint:
    // Uses 10-point bucket, exact label/name/value, and selection state
    const exactBucketX = Math.round(bounds.x / 10);
    const exactBucketY = Math.round(bounds.y / 10);
    const exactBucketW = Math.round(bounds.width / 10);
    const exactBucketH = Math.round(bounds.height / 10);

    const primaryText = element.name || element.label || element.value || "";
    const selState = element.selected ? "sel" : "unsel";

    exactTokens.push(
      `${shortType}|${primaryText}|${selState}|${exactBucketX}_${exactBucketY}_${exactBucketW}_${exactBucketH}`,
    );

    // Structural fingerprint:
    // Uses 30-point coarse buckets, ignores volatile text, and focuses on structural controls
    const normText = normalizeStructuralText(primaryText);
    const coarseBucketX = Math.round(bounds.x / 30);
    const coarseBucketY = Math.round(bounds.y / 30);

    // If pure static text or image has only volatile text, skip from structural signature
    if (
      (shortType === "StaticText" || shortType === "Image") &&
      (normText === "<VOLATILE>" || normText === "")
    ) {
      continue;
    }

    structuralTokens.push(`${shortType}|${normText}|${selState}|${coarseBucketX}_${coarseBucketY}`);
  }

  const exact = hashTokens(exactTokens);
  const structural = hashTokens(structuralTokens);

  return {
    exact,
    structural,
    visual: options?.visualHash,
  };
}
