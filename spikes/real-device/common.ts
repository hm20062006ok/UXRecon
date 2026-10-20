import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const workspaceRoot = path.resolve(import.meta.dirname, "../..");

export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export function redacted(value: string): string {
  if (value.length < 10) return "***";
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function timestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export async function createArtifactDir(prefix: string): Promise<string> {
  const directory = path.join(workspaceRoot, "artifacts", `${prefix}-${timestamp()}`);
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function appiumConnection() {
  return {
    hostname: optional("UXR_APPIUM_HOST", "127.0.0.1"),
    port: Number(optional("UXR_APPIUM_PORT", "4723")),
    path: "/",
    logLevel: "warn" as const,
    connectionRetryCount: 1,
    connectionRetryTimeout: 60_000,
  };
}

export function capabilities() {
  const deviceUdid = required("UXR_DEVICE_UDID");
  return {
    platformName: "iOS",
    "appium:automationName": "XCUITest",
    "appium:udid": deviceUdid,
    "appium:deviceName": optional("UXR_DEVICE_NAME", "iPhone"),
    "appium:platformVersion": required("UXR_PLATFORM_VERSION"),
    "appium:bundleId": optional("UXR_TARGET_BUNDLE_ID", "com.apple.Preferences"),
    "appium:noReset": true,
    "appium:newCommandTimeout": 180,
    "appium:wdaLaunchTimeout": 120_000,
    "appium:wdaConnectionTimeout": 120_000,
    "appium:useNewWDA": false,
    "appium:xcodeOrgId": required("UXR_XCODE_ORG_ID"),
    "appium:xcodeSigningId": optional("UXR_XCODE_SIGNING_ID", "Apple Development"),
    "appium:updatedWDABundleId": required("UXR_WDA_BUNDLE_ID"),
    "appium:allowProvisioningDeviceRegistration":
      optional("UXR_ALLOW_PROVISIONING_DEVICE_REGISTRATION", "0") === "1",
    "appium:showXcodeLog": true,
  };
}
