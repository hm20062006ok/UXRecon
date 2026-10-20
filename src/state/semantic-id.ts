import type { ElementBounds } from "../types/contracts.js";

/** Grid bucket size in points to tolerate minor rendering jitter (e.g. 1-5px shifts). */
const GRID_BUCKET_SIZE = 20;

const VOLATILE_PATTERNS = [
  // Percentages: +180.94%, -2.67%, 50%
  { pattern: /^[+-]?\d+(?:\.\d+)?%$/, replacement: "pct_val" },
  // Currency: $12.34, ¥100, €5.50
  { pattern: /^[$€£¥]\s*[\d,]+(?:\.\d+)?$/, replacement: "currency_val" },
  // Crypto quantities: 0.0543 ETH, 100 BTC
  { pattern: /^[\d,]+(?:\.\d+)?\s*(?:BTC|ETH|USDT|USDC|BNB|SOL)$/i, replacement: "crypto_val" },
  // Time: 14:32, 09:41:20 AM
  { pattern: /^\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?$/, replacement: "time_val" },
  // Dates: 2026-10-20, 10/20/2026
  { pattern: /^\d{4}[-/]\d{2}[-/]\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/, replacement: "date_val" },
  // Hex addresses / hashes
  { pattern: /^0x[a-fA-F0-9]{4,}$/, replacement: "addr_val" },
  // Pure numbers
  { pattern: /^[\d.,+-]+$/, replacement: "num_val" },
];

/**
 * Normalizes text to produce a clean, stable token for semantic identification.
 * Strips dynamic/volatile numbers, currencies, dates, and punctuation.
 */
export function sanitizeStableText(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return "";
  }

  // Check known volatile patterns
  for (const { pattern, replacement } of VOLATILE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return replacement;
    }
  }

  return trimmed
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 40);
}

/**
 * Strips the 'XCUIElementType' prefix if present for cleaner semantic names.
 */
export function getShortElementType(type: string): string {
  if (type.startsWith("XCUIElementType")) {
    return type.slice("XCUIElementType".length);
  }
  return type;
}

export interface SemanticIdInput {
  type: string;
  name?: string | undefined;
  label?: string | undefined;
  value?: string | undefined;
  bounds: ElementBounds;
}

/**
 * Computes a deterministic semantic identifier for a UI element.
 * Stable across repeated observations when representing the same logical control.
 */
export function computeSemanticId(input: SemanticIdInput): string {
  const shortType = getShortElementType(input.type);
  const preferredText = input.name || input.label || input.value || "";
  const cleanText = sanitizeStableText(preferredText);

  const bucketX = Math.round(input.bounds.x / GRID_BUCKET_SIZE);
  const bucketY = Math.round(input.bounds.y / GRID_BUCKET_SIZE);

  if (cleanText) {
    return `${shortType}::${cleanText}::${bucketX}_${bucketY}`;
  }

  const bucketW = Math.round(input.bounds.width / GRID_BUCKET_SIZE);
  const bucketH = Math.round(input.bounds.height / GRID_BUCKET_SIZE);
  return `${shortType}::dim_${bucketW}x${bucketH}::${bucketX}_${bucketY}`;
}
