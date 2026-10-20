import type { DeviceAdapter } from "../device/types.js";
import type { Logger } from "../logging/index.js";
import type { PageState, UIElement } from "../types/contracts.js";
import type { RecoveryResult } from "./types.js";

const BACK_KEYWORDS = ["back", "close", "cancel", "done", "返回", "关闭", "取消", "完成"];

export class RecoveryLadder {
  private readonly logger: Logger;
  private readonly targetBundleId: string;

  constructor(targetBundleId: string, logger: Logger) {
    this.targetBundleId = targetBundleId;
    this.logger = logger.child("recovery");
  }

  verifyRestoration(expectedStructuralFingerprint: string, actualStructuralFingerprint: string): boolean {
    return expectedStructuralFingerprint === actualStructuralFingerprint;
  }

  async recover(
    device: DeviceAdapter,
    expectedPage: PageState,
    currentElements: UIElement[],
  ): Promise<RecoveryResult> {
    this.logger.warn("Parent page structural fingerprint mismatch. Starting recovery ladder.", {
      expectedPageId: expectedPage.pageId,
      expectedFingerprint: expectedPage.fingerprints.structural,
    });

    // Level 1: Find and tap in-app back / close / cancel button
    const backBtn = currentElements.find((el) => {
      if (!el.visible || !el.enabled) return false;
      const text = `${el.label} ${el.name}`.toLowerCase();
      return BACK_KEYWORDS.some((kw) => text.includes(kw));
    });

    if (backBtn) {
      this.logger.info("Recovery Level 1: Tapping in-app back/cancel button", {
        semanticId: backBtn.semanticId,
        label: backBtn.label,
      });
      await device.tap(backBtn);
      return {
        recovered: true,
        level: "in-app-back",
        attempts: 1,
        similarity: 1.0,
      };
    }

    // Level 2: Dismiss keyboard and alerts
    this.logger.info("Recovery Level 2: Dismissing keyboard and alerts");
    await device.dismissKeyboard();
    await device.handleAlert("dismiss");

    // Level 3: Relaunch app
    this.logger.warn("Recovery Level 3: Relaunching target application", {
      bundleId: this.targetBundleId,
    });
    try {
      await device.restartApp(this.targetBundleId);
      return {
        recovered: true,
        level: "app-relaunch",
        attempts: 1,
        similarity: 1.0,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("Recovery failed: app relaunch threw error", { error: message });
      return {
        recovered: false,
        level: "human-intervention",
        attempts: 1,
        similarity: 0.0,
        error: message,
      };
    }
  }
}
