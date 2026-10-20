import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { redacted, workspaceRoot } from "./common.js";

const execFileAsync = promisify(execFile);

type Status = "PASS" | "WARN" | "FAIL";
type Check = { name: string; status: Status; detail: string };

async function command(file: string, args: string[] = []): Promise<string> {
  const result = await execFileAsync(file, args, {
    encoding: "utf8",
    env: { ...process.env, APPIUM_HOME: path.join(workspaceRoot, ".appium") },
    timeout: 30_000,
  });
  return `${result.stdout}${result.stderr}`.trim();
}

async function checkCommand(name: string, file: string, args: string[]): Promise<Check> {
  try {
    return { name, status: "PASS", detail: await command(file, args) };
  } catch (error) {
    return { name, status: "FAIL", detail: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const checks = await Promise.all([
    checkCommand("Xcode", "xcodebuild", ["-version"]),
    checkCommand("Node.js", "node", ["--version"]),
    checkCommand("Codex CLI", "codex", ["--version"]),
    checkCommand("Appium", path.join(workspaceRoot, "node_modules", ".bin", "appium"), ["--version"]),
    checkCommand("XCUITest driver", path.join(workspaceRoot, "node_modules", ".bin", "appium"), [
      "driver",
      "list",
      "--installed",
    ]),
    checkCommand("Connected devices", "xcrun", ["devicectl", "list", "devices"]),
  ]);

  const envChecks: Check[] = [
    ["UXR_DEVICE_UDID", true],
    ["UXR_PLATFORM_VERSION", true],
    ["UXR_XCODE_ORG_ID", true],
    ["UXR_WDA_BUNDLE_ID", true],
    ["UXR_ALLOW_PROVISIONING_DEVICE_REGISTRATION", false],
    ["UXR_TARGET_BUNDLE_ID", false],
  ].map(([name, mandatory]) => {
    const value = process.env[String(name)]?.trim();
    return value
      ? { name: `Environment ${name}`, status: "PASS", detail: redacted(value) }
      : {
          name: `Environment ${name}`,
          status: mandatory ? "FAIL" : "WARN",
          detail: mandatory ? "Required for a real-device session" : "Defaults to com.apple.Preferences",
        };
  });

  const all = [...checks, ...envChecks];
  for (const item of all) {
    console.log(`[${item.status}] ${item.name}`);
    console.log(
      item.detail
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
    );
  }

  if (all.some((item) => item.status === "FAIL")) process.exitCode = 1;
}

await main();
