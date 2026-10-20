/**
 * Central error catalogue. Every user-facing failure carries a stable code so
 * reports, logs and tests can reference it without matching on message text.
 */

export interface ErrorDefinition {
  readonly title: string;
  readonly hint: string;
}

export const errorCatalog = {
  "UXR-CFG-001": {
    title: "Configuration file not found",
    hint: "Pass --config <path>, or copy config.example.yaml to config.yaml.",
  },
  "UXR-CFG-002": {
    title: "Configuration is not valid YAML",
    hint: "Fix the YAML syntax. The parser error reports the line and column.",
  },
  "UXR-CFG-003": {
    title: "Configuration failed validation",
    hint: "Each issue below names the field and what was expected. Compare with config.example.yaml.",
  },
  "UXR-CFG-004": {
    title: "Missing environment variable",
    hint: "Export the variable before running, or give the placeholder a default with ${VAR:-fallback}.",
  },
  "UXR-CFG-005": {
    title: "Unsupported configuration schema version",
    hint: "Use a schemaVersion this build understands, or upgrade the CLI.",
  },
  "UXR-DEV-001": {
    title: "No matching iOS device connected",
    hint: "Connect the iPhone over USB, unlock it, trust this Mac, and confirm the UDID in `xcrun devicectl list devices`.",
  },
  "UXR-DEV-002": {
    title: "Appium server unreachable",
    hint: "Start it with `npm run p0:appium`, or point appium.host/appium.port at a running server.",
  },
  "UXR-DEV-003": {
    title: "Target app is not installed",
    hint: "Install the app on the device, or correct app.bundleId.",
  },
  "UXR-DEV-004": {
    title: "Device screen is locked or unauthorized for UI testing",
    hint: "Unlock your iPhone screen with passcode/Face ID, keep the target App in the foreground, and prevent the screen from sleeping (Settings -> Display & Brightness -> Auto-Lock -> Never).",
  },
  "UXR-DOC-001": {
    title: "Doctor found blocking problems",
    hint: "Fix the checks marked FAIL, then run `uxr doctor` again.",
  },
  "UXR-CLI-001": {
    title: "Unknown command",
    hint: "Run `uxr --help` to list available commands.",
  },
  "UXR-CLI-002": {
    title: "Invalid command line arguments",
    hint: "Run `uxr <command> --help` for the accepted flags.",
  },
  "UXR-INT-001": {
    title: "Unexpected internal error",
    hint: "Re-run with --verbose to capture the full stack trace.",
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof errorCatalog;
