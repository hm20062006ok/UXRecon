import type { UIElement, Viewport } from "../types/contracts.js";

export interface ActiveAppInfo {
  bundleId: string;
  processId?: number | undefined;
}

export interface ActionResult {
  success: boolean;
  durationMs: number;
  error?: string | undefined;
}

export interface ScrollResult {
  success: boolean;
  durationMs: number;
}

export interface BackResult {
  success: boolean;
  durationMs: number;
}

export type ScrollDirection = "up" | "down" | "left" | "right";
export type AlertAction = "accept" | "dismiss";

export interface DeviceAdapter {
  /** Connect to the device and initialize the Appium / WDA session. */
  connect(): Promise<void>;

  /** Gracefully disconnect and terminate the Appium / WDA session. */
  disconnect(): Promise<void>;

  /** Check if the connection to the device / WDA session is healthy. */
  isHealthy(): Promise<boolean>;

  /** Capture screenshot as base64 or file path. */
  takeScreenshot(): Promise<string>;

  /** Get XML page source of current active screen. */
  getPageSource(): Promise<string>;

  /** Get screen viewport dimension. */
  getViewport(): Promise<Viewport>;

  /** Get device orientation (e.g. PORTRAIT / LANDSCAPE). */
  getOrientation(): Promise<string>;

  /** Get info of current foreground active app. */
  getActiveApp(): Promise<ActiveAppInfo>;

  /** Tap on target UIElement using locator fallback. */
  tap(target: UIElement): Promise<ActionResult>;

  /** Type text into target UIElement using locator fallback. */
  typeText(target: UIElement, text: string): Promise<ActionResult>;

  /** Clear text in target UIElement using locator fallback. */
  clearText(target: UIElement): Promise<ActionResult>;

  /** Scroll screen in specified direction. */
  scroll(direction: ScrollDirection): Promise<ScrollResult>;

  /** Trigger back navigation (via pressButton or navigation fallback). */
  back(): Promise<BackResult>;

  /** Dismiss onscreen keyboard if active. */
  dismissKeyboard(): Promise<boolean>;

  /** Accept or dismiss active alert modal. */
  handleAlert(action: AlertAction): Promise<boolean>;

  /** Restart target application or current configured app. */
  restartApp(bundleId?: string): Promise<void>;
}
