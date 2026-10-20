import type { Logger } from "../logging/index.js";
import type { UIElement, Viewport } from "../types/contracts.js";
import type {
  ActionResult,
  ActiveAppInfo,
  AlertAction,
  BackResult,
  DeviceAdapter,
  ScrollDirection,
  ScrollResult,
} from "./types.js";

export interface RecordedDryRunAction {
  kind: "tap" | "type" | "clear" | "scroll" | "back" | "dismissKeyboard" | "handleAlert" | "restartApp";
  target?: UIElement | undefined;
  text?: string | undefined;
  direction?: ScrollDirection | undefined;
  alertAction?: AlertAction | undefined;
  bundleId?: string | undefined;
  timestamp: string;
}

export class DryRunDeviceAdapter implements DeviceAdapter {
  private readonly inner: DeviceAdapter;
  private readonly logger: Logger;
  private readonly recordedActions: RecordedDryRunAction[] = [];

  constructor(inner: DeviceAdapter, logger: Logger) {
    this.inner = inner;
    this.logger = logger;
  }

  getInnerAdapter(): DeviceAdapter {
    return this.inner;
  }

  getRecordedActions(): readonly RecordedDryRunAction[] {
    return this.recordedActions;
  }

  clearRecordedActions(): void {
    this.recordedActions.length = 0;
  }

  // --- Read operations: Pass through directly to inner adapter ---

  async connect(): Promise<void> {
    await this.inner.connect();
  }

  async disconnect(): Promise<void> {
    await this.inner.disconnect();
  }

  async isHealthy(): Promise<boolean> {
    return await this.inner.isHealthy();
  }

  async takeScreenshot(): Promise<string> {
    return await this.inner.takeScreenshot();
  }

  async getPageSource(): Promise<string> {
    return await this.inner.getPageSource();
  }

  async getViewport(): Promise<Viewport> {
    return await this.inner.getViewport();
  }

  async getOrientation(): Promise<string> {
    return await this.inner.getOrientation();
  }

  async getActiveApp(): Promise<ActiveAppInfo> {
    return await this.inner.getActiveApp();
  }

  // --- Write operations: Simulated and recorded, not executed on device ---

  async tap(target: UIElement): Promise<ActionResult> {
    await Promise.resolve();
    const action: RecordedDryRunAction = {
      kind: "tap",
      target,
      timestamp: new Date().toISOString(),
    };
    this.recordedActions.push(action);
    this.logger.info(`[DRY-RUN] Simulated tap on element "${target.elementId}" (${target.semanticId})`, {
      elementId: target.elementId,
      semanticId: target.semanticId,
    });
    return { success: true, durationMs: 20 };
  }

  async typeText(target: UIElement, text: string): Promise<ActionResult> {
    await Promise.resolve();
    const action: RecordedDryRunAction = {
      kind: "type",
      target,
      text,
      timestamp: new Date().toISOString(),
    };
    this.recordedActions.push(action);
    this.logger.info(`[DRY-RUN] Simulated typeText on element "${target.elementId}": "${text}"`, {
      elementId: target.elementId,
      textLength: text.length,
    });
    return { success: true, durationMs: 30 };
  }

  async clearText(target: UIElement): Promise<ActionResult> {
    await Promise.resolve();
    const action: RecordedDryRunAction = {
      kind: "clear",
      target,
      timestamp: new Date().toISOString(),
    };
    this.recordedActions.push(action);
    this.logger.info(`[DRY-RUN] Simulated clearText on element "${target.elementId}"`, {
      elementId: target.elementId,
    });
    return { success: true, durationMs: 20 };
  }

  async scroll(direction: ScrollDirection): Promise<ScrollResult> {
    await Promise.resolve();
    const action: RecordedDryRunAction = {
      kind: "scroll",
      direction,
      timestamp: new Date().toISOString(),
    };
    this.recordedActions.push(action);
    this.logger.info(`[DRY-RUN] Simulated scroll: direction=${direction}`);
    return { success: true, durationMs: 25 };
  }

  async back(): Promise<BackResult> {
    await Promise.resolve();
    const action: RecordedDryRunAction = {
      kind: "back",
      timestamp: new Date().toISOString(),
    };
    this.recordedActions.push(action);
    this.logger.info("[DRY-RUN] Simulated back navigation");
    return { success: true, durationMs: 15 };
  }

  async dismissKeyboard(): Promise<boolean> {
    await Promise.resolve();
    const action: RecordedDryRunAction = {
      kind: "dismissKeyboard",
      timestamp: new Date().toISOString(),
    };
    this.recordedActions.push(action);
    this.logger.info("[DRY-RUN] Simulated dismissKeyboard");
    return true;
  }

  async handleAlert(actionKind: AlertAction): Promise<boolean> {
    await Promise.resolve();
    const action: RecordedDryRunAction = {
      kind: "handleAlert",
      alertAction: actionKind,
      timestamp: new Date().toISOString(),
    };
    this.recordedActions.push(action);
    this.logger.info(`[DRY-RUN] Simulated handleAlert: action=${actionKind}`);
    return true;
  }

  async restartApp(bundleId?: string): Promise<void> {
    await Promise.resolve();
    const action: RecordedDryRunAction = {
      kind: "restartApp",
      bundleId,
      timestamp: new Date().toISOString(),
    };
    this.recordedActions.push(action);
    this.logger.info(`[DRY-RUN] Simulated restartApp: bundleId=${bundleId ?? "(configured)"}`);
  }
}
