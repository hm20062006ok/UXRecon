import type { BoundaryCheckResult } from "./types.js";

const SYSTEM_SPRINGBOARD = "com.apple.springboard";

export class BoundaryGuard {
  private readonly expectedBundleId: string;

  constructor(expectedBundleId: string) {
    this.expectedBundleId = expectedBundleId;
  }

  check(currentBundleId: string): BoundaryCheckResult {
    const trimmed = currentBundleId.trim();

    if (trimmed === this.expectedBundleId) {
      return {
        allowed: true,
        expectedBundleId: this.expectedBundleId,
        actualBundleId: trimmed,
      };
    }

    if (trimmed === SYSTEM_SPRINGBOARD) {
      return {
        allowed: true,
        expectedBundleId: this.expectedBundleId,
        actualBundleId: trimmed,
        reason: "System alert / SpringBoard active over target app",
      };
    }

    return {
      allowed: true,
      expectedBundleId: this.expectedBundleId,
      actualBundleId: trimmed,
      reason: `Device is at ${trimmed} (outside target app ${this.expectedBundleId}); restriction removed to allow cross-app navigation.`,
    };
  }
}
