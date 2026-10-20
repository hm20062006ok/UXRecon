import type { Config } from "../config/index.js";
import type { Logger } from "../logging/index.js";
import { DryRunDeviceAdapter } from "./dry-run.js";
import { RealDeviceAdapter } from "./real-adapter.js";
import { SessionManager } from "./session.js";
import type { DeviceAdapter } from "./types.js";

export function createDeviceAdapter(config: Config, logger: Logger, clientOverride?: unknown): DeviceAdapter {
  const sessionManager = new SessionManager(config, logger.child("session"), clientOverride);
  const realAdapter = new RealDeviceAdapter(config, sessionManager, logger.child("device"));

  if (config.exploration.dryRun) {
    logger.info("Exploration dry-run mode enabled: Device write operations will be simulated");
    return new DryRunDeviceAdapter(realAdapter, logger.child("dry-run"));
  }

  return realAdapter;
}

export {
  type ActionResult,
  type ActiveAppInfo,
  type AlertAction,
  type BackResult,
  type DeviceAdapter,
  type ScrollDirection,
  type ScrollResult,
} from "./types.js";

export {
  SessionManager,
  buildCapabilities,
  buildConnectionOptions,
  mapSessionError,
  withTimeout,
  type WdioClient,
  type WdioElement,
} from "./session.js";

export { RealDeviceAdapter, candidateToWdioSelector, prioritizeCandidates } from "./real-adapter.js";

export { DryRunDeviceAdapter, type RecordedDryRunAction } from "./dry-run.js";
