import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CommandRunner, HttpProbe } from "./types.js";

const execFileAsync = promisify(execFile);

export const defaultCommandRunner: CommandRunner = async (command, args, options = {}) => {
  const timeoutMs = options.timeoutMs ?? 20_000;
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      env: options.env ?? process.env,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      code: 0,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "number") {
      const err = error as { code: number; stdout?: string; stderr?: string };
      return {
        code: err.code,
        stdout: (err.stdout ?? "").trim(),
        stderr: (err.stderr ?? "").trim(),
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      code: 1,
      stdout: "",
      stderr: message,
    };
  }
};

export const defaultHttpProbe: HttpProbe = async (url, options = {}) => {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 0,
      body: message,
    };
  } finally {
    clearTimeout(timer);
  }
};
