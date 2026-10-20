import readline from "node:readline";
import type { ConfirmHandler, ConfirmRequest } from "./types.js";

export function createInteractiveConfirmHandler(options: { timeoutMs?: number } = {}): ConfirmHandler {
  const timeoutMs = options.timeoutMs ?? 30_000;

  return async (request: ConfirmRequest): Promise<boolean> => {
    // If not a TTY (CI or headless), default to safe denial
    if (!process.stdin.isTTY) {
      return false;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    const lines = [
      "",
      "⚠️  [UXRecon Safety Confirmation Required]",
      `Action: ${request.action.kind}`,
      request.target
        ? `Target: [${request.target.type}] "${request.target.label || request.target.name}"`
        : "",
      `Reason: ${request.reason}`,
      request.screenshotPath ? `Screenshot: ${request.screenshotPath}` : "",
      "Allow this action to proceed? (y/N) [Default: N (No)]: ",
    ].filter(Boolean);

    const promptText = `${lines.slice(0, -1).join("\n")}\n${lines[lines.length - 1]}`;

    return new Promise<boolean>((resolve) => {
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          rl.close();
          process.stderr.write("\nConfirmation timed out. Action DENIED by default.\n");
          resolve(false);
        }
      }, timeoutMs);

      rl.question(promptText, (answer) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          rl.close();
          const approved = answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
          resolve(approved);
        }
      });
    });
  };
}

/** Always rejects. Safe for CI and autonomous tests. */
export const defaultRejectConfirmHandler: ConfirmHandler = () => Promise.resolve(false);
