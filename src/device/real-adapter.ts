import type { Config } from "../config/index.js";
import type { Logger } from "../logging/index.js";
import type { LocatorCandidate, LocatorStrategy, UIElement, Viewport } from "../types/contracts.js";
import type { SessionManager, WdioClient } from "./session.js";
import type {
  ActionResult,
  ActiveAppInfo,
  AlertAction,
  BackResult,
  DeviceAdapter,
  ScrollDirection,
  ScrollResult,
} from "./types.js";

const STRATEGY_PRIORITY: Record<LocatorStrategy, number> = {
  accessibility_id: 1,
  predicate: 2,
  class_chain: 3,
  xpath: 4,
};

export function candidateToWdioSelector(candidate: LocatorCandidate): string {
  const { strategy, selector } = candidate;
  switch (strategy) {
    case "accessibility_id":
      return selector.startsWith("~") ? selector : `~${selector}`;
    case "predicate":
      return selector.startsWith("-ios predicate string:") ? selector : `-ios predicate string:${selector}`;
    case "class_chain":
      return selector.startsWith("-ios class chain:") ? selector : `-ios class chain:${selector}`;
    case "xpath":
      return selector.startsWith("/") || selector.startsWith("xpath=") ? selector : `xpath=${selector}`;
    default:
      return selector;
  }
}

export function prioritizeCandidates(candidates: LocatorCandidate[]): LocatorCandidate[] {
  return [...candidates].sort((a, b) => {
    const prioA = STRATEGY_PRIORITY[a.strategy] ?? 99;
    const prioB = STRATEGY_PRIORITY[b.strategy] ?? 99;
    if (prioA !== prioB) {
      return prioA - prioB;
    }
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
}

export class RealDeviceAdapter implements DeviceAdapter {
  private readonly config: Config;
  private readonly sessionManager: SessionManager;
  private readonly logger: Logger;

  constructor(config: Config, sessionManager: SessionManager, logger: Logger) {
    this.config = config;
    this.sessionManager = sessionManager;
    this.logger = logger;
  }

  private ensureClient(): WdioClient {
    return this.sessionManager.getClient();
  }

  async connect(): Promise<void> {
    await this.sessionManager.connect();
  }

  async disconnect(): Promise<void> {
    await this.sessionManager.disconnect();
  }

  async isHealthy(): Promise<boolean> {
    return await this.sessionManager.isHealthy();
  }

  async takeScreenshot(): Promise<string> {
    const client = this.ensureClient();
    return await client.takeScreenshot();
  }

  async getPageSource(): Promise<string> {
    const client = this.ensureClient();
    return await client.getPageSource();
  }

  async getViewport(): Promise<Viewport> {
    const client = this.ensureClient();
    const size = await client.getWindowSize();
    return {
      width: size.width,
      height: size.height,
    };
  }

  async getOrientation(): Promise<string> {
    const client = this.ensureClient();
    return await client.getOrientation();
  }

  async getActiveApp(): Promise<ActiveAppInfo> {
    const client = this.ensureClient();
    try {
      const res = (await client.execute("mobile: activeAppInfo", {})) as
        { bundleId?: string; processId?: number; pid?: number } | undefined;
      return {
        bundleId: res?.bundleId ?? "",
        processId: res?.processId ?? res?.pid,
      };
    } catch (err) {
      this.logger.warn("Failed to get activeAppInfo from device", { error: String(err) });
      return { bundleId: "" };
    }
  }

  async tap(target: UIElement): Promise<ActionResult> {
    const start = Date.now();
    const client = this.ensureClient();
    const candidates = prioritizeCandidates(target.locatorCandidates);

    if (candidates.length === 0) {
      const durationMs = Date.now() - start;
      const err = `No locator candidates provided for element ${target.elementId} (${target.semanticId})`;
      this.logger.warn("tap skipped: no locator candidates", { elementId: target.elementId });
      return { success: false, durationMs, error: err };
    }

    const attemptErrors: string[] = [];
    for (const candidate of candidates) {
      const selector = candidateToWdioSelector(candidate);
      try {
        const el = await client.$(selector);
        const exists = await el.isExisting();
        if (exists) {
          await el.click();
          const durationMs = Date.now() - start;
          this.logger.info(`tap succeeded via ${candidate.strategy}`, {
            elementId: target.elementId,
            strategy: candidate.strategy,
            durationMs,
          });
          return { success: true, durationMs };
        }
        attemptErrors.push(`${candidate.strategy}: element does not exist`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attemptErrors.push(`${candidate.strategy}: ${msg}`);
        this.logger.debug(`Candidate ${candidate.strategy} failed, falling back`, {
          elementId: target.elementId,
          error: msg,
        });
      }
    }

    const durationMs = Date.now() - start;
    const errorSummary = `Failed to tap element ${target.elementId} after trying ${candidates.length} candidate(s): [${attemptErrors.join("; ")}]`;
    this.logger.warn("tap failed on all candidates", {
      elementId: target.elementId,
      durationMs,
      error: errorSummary,
    });
    return { success: false, durationMs, error: errorSummary };
  }

  async typeText(target: UIElement, text: string): Promise<ActionResult> {
    const start = Date.now();
    const client = this.ensureClient();
    const candidates = prioritizeCandidates(target.locatorCandidates);

    if (candidates.length === 0) {
      const durationMs = Date.now() - start;
      const err = `No locator candidates provided for element ${target.elementId} (${target.semanticId})`;
      this.logger.warn("typeText skipped: no locator candidates", { elementId: target.elementId });
      return { success: false, durationMs, error: err };
    }

    const attemptErrors: string[] = [];
    for (const candidate of candidates) {
      const selector = candidateToWdioSelector(candidate);
      try {
        const el = await client.$(selector);
        const exists = await el.isExisting();
        if (exists) {
          await el.setValue(text);
          const durationMs = Date.now() - start;
          this.logger.info(`typeText succeeded via ${candidate.strategy}`, {
            elementId: target.elementId,
            strategy: candidate.strategy,
            durationMs,
          });
          return { success: true, durationMs };
        }
        attemptErrors.push(`${candidate.strategy}: element does not exist`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attemptErrors.push(`${candidate.strategy}: ${msg}`);
        this.logger.debug(`Candidate ${candidate.strategy} failed during typeText, falling back`, {
          elementId: target.elementId,
          error: msg,
        });
      }
    }

    const durationMs = Date.now() - start;
    const errorSummary = `Failed to typeText into element ${target.elementId} after trying ${candidates.length} candidate(s): [${attemptErrors.join("; ")}]`;
    this.logger.warn("typeText failed on all candidates", {
      elementId: target.elementId,
      durationMs,
      error: errorSummary,
    });
    return { success: false, durationMs, error: errorSummary };
  }

  async clearText(target: UIElement): Promise<ActionResult> {
    const start = Date.now();
    const client = this.ensureClient();
    const candidates = prioritizeCandidates(target.locatorCandidates);

    if (candidates.length === 0) {
      const durationMs = Date.now() - start;
      const err = `No locator candidates provided for element ${target.elementId} (${target.semanticId})`;
      this.logger.warn("clearText skipped: no locator candidates", {
        elementId: target.elementId,
      });
      return { success: false, durationMs, error: err };
    }

    const attemptErrors: string[] = [];
    for (const candidate of candidates) {
      const selector = candidateToWdioSelector(candidate);
      try {
        const el = await client.$(selector);
        const exists = await el.isExisting();
        if (exists) {
          await el.clearValue();
          const durationMs = Date.now() - start;
          this.logger.info(`clearText succeeded via ${candidate.strategy}`, {
            elementId: target.elementId,
            strategy: candidate.strategy,
            durationMs,
          });
          return { success: true, durationMs };
        }
        attemptErrors.push(`${candidate.strategy}: element does not exist`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attemptErrors.push(`${candidate.strategy}: ${msg}`);
        this.logger.debug(`Candidate ${candidate.strategy} failed during clearText, falling back`, {
          elementId: target.elementId,
          error: msg,
        });
      }
    }

    const durationMs = Date.now() - start;
    const errorSummary = `Failed to clearText in element ${target.elementId} after trying ${candidates.length} candidate(s): [${attemptErrors.join("; ")}]`;
    this.logger.warn("clearText failed on all candidates", {
      elementId: target.elementId,
      durationMs,
      error: errorSummary,
    });
    return { success: false, durationMs, error: errorSummary };
  }

  async scroll(direction: ScrollDirection): Promise<ScrollResult> {
    const start = Date.now();
    const client = this.ensureClient();
    try {
      await client.execute("mobile: scroll", { direction });
      const durationMs = Date.now() - start;
      this.logger.info(`scroll succeeded via mobile: scroll (direction=${direction})`, {
        durationMs,
      });
      return { success: true, durationMs };
    } catch (err) {
      this.logger.warn("mobile: scroll failed, attempting mobile: swipe fallback", {
        error: String(err),
      });
      try {
        await client.execute("mobile: swipe", { direction });
        const durationMs = Date.now() - start;
        this.logger.info(`scroll succeeded via mobile: swipe fallback (direction=${direction})`, {
          durationMs,
        });
        return { success: true, durationMs };
      } catch (swipeErr) {
        const durationMs = Date.now() - start;
        this.logger.error("scroll failed on both mobile: scroll and mobile: swipe", {
          error: String(swipeErr),
        });
        return { success: false, durationMs };
      }
    }
  }

  async back(): Promise<BackResult> {
    const start = Date.now();
    const client = this.ensureClient();
    try {
      await client.execute("mobile: pressButton", { name: "back" });
      const durationMs = Date.now() - start;
      this.logger.info("back succeeded via mobile: pressButton", { durationMs });
      return { success: true, durationMs };
    } catch (err) {
      this.logger.warn("mobile: pressButton back failed, attempting driver.back()", {
        error: String(err),
      });
      try {
        if (typeof client.back === "function") {
          await client.back();
        }
        const durationMs = Date.now() - start;
        this.logger.info("back succeeded via driver.back() fallback", { durationMs });
        return { success: true, durationMs };
      } catch (backErr) {
        const durationMs = Date.now() - start;
        this.logger.error("back failed on all mechanisms", { error: String(backErr) });
        return { success: false, durationMs };
      }
    }
  }

  async dismissKeyboard(): Promise<boolean> {
    const client = this.ensureClient();
    try {
      await client.execute("mobile: dismissKeyboard", {});
      this.logger.info("dismissKeyboard succeeded via mobile: dismissKeyboard");
      return true;
    } catch (err) {
      this.logger.debug("mobile: dismissKeyboard failed, trying client.hideKeyboard()", {
        error: String(err),
      });
      try {
        if (typeof client.hideKeyboard === "function") {
          await client.hideKeyboard();
          this.logger.info("dismissKeyboard succeeded via hideKeyboard()");
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }
  }

  async handleAlert(action: AlertAction): Promise<boolean> {
    const client = this.ensureClient();
    try {
      if (action === "accept") {
        if (typeof client.acceptAlert === "function") {
          await client.acceptAlert();
          this.logger.info("Alert accepted via acceptAlert()");
          return true;
        }
      } else {
        if (typeof client.dismissAlert === "function") {
          await client.dismissAlert();
          this.logger.info("Alert dismissed via dismissAlert()");
          return true;
        }
      }
      await client.execute("mobile: alert", { action });
      this.logger.info(`Alert handled via mobile: alert (action=${action})`);
      return true;
    } catch (err) {
      this.logger.debug("Native alert action failed, attempting mobile: alert fallback", {
        error: String(err),
      });
      try {
        await client.execute("mobile: alert", { action });
        this.logger.info(`Alert handled via mobile: alert fallback (action=${action})`);
        return true;
      } catch {
        this.logger.warn(`Failed to handle alert with action "${action}"`);
        return false;
      }
    }
  }

  async restartApp(bundleId?: string): Promise<void> {
    const client = this.ensureClient();
    const targetBundleId = bundleId ?? this.config.app.bundleId;
    this.logger.info(`Restarting target application: ${targetBundleId}`);

    try {
      await client.execute("mobile: terminateApp", { bundleId: targetBundleId });
    } catch (err) {
      this.logger.debug("mobile: terminateApp ignored or not running", { error: String(err) });
    }

    if (typeof client.pause === "function") {
      await client.pause(500);
    }

    await client.execute("mobile: launchApp", { bundleId: targetBundleId });

    if (typeof client.pause === "function") {
      await client.pause(1000);
    }

    this.logger.info(`Target application restarted: ${targetBundleId}`);
  }
}
