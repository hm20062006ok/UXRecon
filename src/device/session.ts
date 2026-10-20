import { remote } from "webdriverio";
import type { Config } from "../config/index.js";
import { AppError, isAppError, toAppError } from "../errors/index.js";
import type { Logger } from "../logging/index.js";

export interface WdioElement {
  isExisting(): Promise<boolean>;
  isDisplayed?(): Promise<boolean>;
  click(): Promise<void>;
  setValue(value: string): Promise<void>;
  clearValue(): Promise<void>;
  getText?(): Promise<string>;
  getTagName?(): Promise<string>;
  getLocation?(): Promise<{ x: number; y: number }>;
  getSize?(): Promise<{ width: number; height: number }>;
}

export interface WdioClient {
  takeScreenshot(): Promise<string>;
  getPageSource(): Promise<string>;
  getWindowSize(): Promise<{ width: number; height: number }>;
  getOrientation(): Promise<string>;
  execute(script: string, ...args: unknown[]): Promise<unknown>;
  $(selector: string): Promise<WdioElement>;
  back?(): Promise<void>;
  hideKeyboard?(): Promise<void>;
  acceptAlert?(): Promise<void>;
  dismissAlert?(): Promise<void>;
  pause?(ms: number): Promise<void>;
  deleteSession?(): Promise<unknown>;
  status?(): Promise<unknown>;
}

export function buildCapabilities(config: Config): Record<string, unknown> {
  const caps: Record<string, unknown> = {
    platformName: "iOS",
    "appium:automationName": "XCUITest",
    "appium:udid": config.device.udid,
    "appium:deviceName": config.device.name || "iPhone",
    "appium:platformVersion": config.device.platformVersion,
    "appium:bundleId": config.app.bundleId,
    "appium:noReset": true,
    "appium:newCommandTimeout": config.appium.newCommandTimeoutSec,
    "appium:wdaLaunchTimeout": config.appium.wdaLaunchTimeoutMs,
    "appium:wdaConnectionTimeout": config.appium.wdaConnectionTimeoutMs,
    "appium:useNewWDA": false,
    "appium:showXcodeLog": true,
  };

  if (config.appium.webDriverAgentUrl) {
    caps["appium:webDriverAgentUrl"] = config.appium.webDriverAgentUrl;
  } else {
    caps["appium:xcodeOrgId"] = config.appium.xcodeOrgId;
    caps["appium:xcodeSigningId"] = config.appium.xcodeSigningId;
    caps["appium:updatedWDABundleId"] = config.appium.updatedWDABundleId;
    caps["appium:allowProvisioningDeviceRegistration"] = config.appium.allowProvisioningDeviceRegistration;
  }

  return caps;
}

export function buildConnectionOptions(config: Config) {
  return {
    hostname: config.appium.host,
    port: config.appium.port,
    path: config.appium.basePath,
    logLevel: "warn" as const,
    strictSelectors: false,
    connectionRetryCount: 1,
    connectionRetryTimeout: config.appium.wdaConnectionTimeoutMs,
  };
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function mapSessionError(err: unknown, config: Config): AppError {
  if (isAppError(err)) {
    return err;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes("ECONNREFUSED") ||
    msg.includes("fetch failed") ||
    msg.includes("unreachable") ||
    msg.includes("connect refused")
  ) {
    return new AppError(
      "UXR-DEV-002",
      `Appium server unreachable at ${config.appium.host}:${config.appium.port}: ${msg}`,
      { cause: err, context: { host: config.appium.host, port: config.appium.port } },
    );
  }
  if (
    msg.includes("device") ||
    msg.includes("UDID") ||
    msg.includes("No device found") ||
    msg.includes("device not connected")
  ) {
    return new AppError("UXR-DEV-001", `iOS device with UDID ${config.device.udid} not accessible: ${msg}`, {
      cause: err,
      context: { udid: config.device.udid },
    });
  }
  if (
    msg.includes("bundleId") ||
    msg.includes("is not installed") ||
    msg.includes("Target app") ||
    msg.includes("Failed to launch")
  ) {
    return new AppError(
      "UXR-DEV-003",
      `Target app "${config.app.bundleId}" is not installed or failed to launch: ${msg}`,
      { cause: err, context: { bundleId: config.app.bundleId } },
    );
  }
  return toAppError(err, "UXR-DEV-002");
}

export class SessionManager {
  private readonly config: Config;
  private readonly logger: Logger;
  private client: WdioClient | null = null;
  private readonly clientOverride: WdioClient | undefined;
  private cleanExitHandler: (() => void) | undefined;

  constructor(config: Config, logger: Logger, clientOverride?: unknown) {
    this.config = config;
    this.logger = logger;
    this.clientOverride = clientOverride as WdioClient | undefined;
  }

  async connect(): Promise<WdioClient> {
    if (this.client) {
      return this.client;
    }

    if (this.clientOverride) {
      this.logger.info("Using injected client override for Appium session");
      this.client = this.clientOverride;
      this.registerExitHandlers();
      return this.client;
    }

    const connectionOpts = buildConnectionOptions(this.config);
    const caps = buildCapabilities(this.config);

    this.logger.info("Connecting to Appium / WDA session", {
      host: this.config.appium.host,
      port: this.config.appium.port,
      udid: this.config.device.udid,
      bundleId: this.config.app.bundleId,
    });

    const timeoutMs = this.config.appium.wdaLaunchTimeoutMs + 30_000;
    try {
      const browser = await withTimeout(
        remote({
          ...connectionOpts,
          capabilities: caps,
        }),
        timeoutMs,
        `Session initialization timed out after ${timeoutMs}ms`,
      );

      this.client = browser as unknown as WdioClient;
      this.registerExitHandlers();
      this.logger.info("Appium / WDA session connected successfully");
      return this.client;
    } catch (err) {
      this.logger.error("Failed to establish Appium / WDA session", { error: String(err) });
      throw mapSessionError(err, this.config);
    }
  }

  async disconnect(): Promise<void> {
    this.unregisterExitHandlers();
    if (!this.client) {
      return;
    }

    const clientToClose = this.client;
    this.client = null;

    this.logger.info("Disconnecting Appium / WDA session");
    try {
      if (typeof clientToClose.deleteSession === "function") {
        await clientToClose.deleteSession();
      }
      this.logger.info("Appium / WDA session closed cleanly");
    } catch (err) {
      this.logger.warn("Error encountered while closing Appium / WDA session", {
        error: String(err),
      });
    }
  }

  getClient(): WdioClient {
    if (!this.client) {
      throw new Error("Device session is not connected. Call connect() first.");
    }
    return this.client;
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  async isHealthy(): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    try {
      if (typeof this.client.status === "function") {
        await this.client.status();
      } else {
        await this.client.getOrientation();
      }
      return true;
    } catch {
      return false;
    }
  }

  private registerExitHandlers(): void {
    if (this.cleanExitHandler) return;
    if (process.env["VITEST"] === "true") return;
    this.cleanExitHandler = () => {
      if (this.client) {
        this.logger.warn("Process exit signal received; disconnecting Appium session");
        void this.disconnect().catch(() => undefined);
      }
    };
    process.once("SIGINT", this.cleanExitHandler);
    process.once("SIGTERM", this.cleanExitHandler);
  }

  private unregisterExitHandlers(): void {
    if (this.cleanExitHandler) {
      process.removeListener("SIGINT", this.cleanExitHandler);
      process.removeListener("SIGTERM", this.cleanExitHandler);
      this.cleanExitHandler = undefined;
    }
  }
}
