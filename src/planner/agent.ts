import { spawn } from "node:child_process";
import type { AgentConfig } from "../config/types.js";
import type { Logger } from "../logging/index.js";
import type { PlannedAction } from "../types/contracts.js";
import { DeterministicPlanner } from "./deterministic.js";
import { buildPlannerPrompt } from "./prompt.js";
import { parsePlannedAction } from "./schema.js";
import type { PlanContext, Planner } from "./types.js";

function resolveDefaultAgentArgs(config: AgentConfig): string[] {
  if (config.args.length > 0) return [...config.args];

  if (config.provider === "codex") {
    const args = ["exec", "--skip-git-repo-check", "--sandbox", "read-only"];
    if (config.model) {
      args.push("-m", config.model);
    }
    args.push("-");
    return args;
  }

  if (config.provider === "claude") {
    const args = ["-p"];
    if (config.model) {
      args.push("--model", config.model);
    }
    return args;
  }

  if (config.provider === "opencode") {
    const args = ["run"];
    if (config.model) {
      args.push("-m", config.model);
    }
    return args;
  }

  return [];
}

function extractJsonFromOutput(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try code fence ```json ... ```
    const matchFence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
    if (matchFence?.[1]) {
      try {
        return JSON.parse(matchFence[1].trim());
      } catch {
        // continue
      }
    }
    // Try finding the outermost JSON object {...}
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const candidate = trimmed.slice(start, end + 1);
      return JSON.parse(candidate);
    }
    throw new Error(`Could not parse JSON from agent output: ${trimmed.slice(0, 300)}`);
  }
}

export class AiAgentPlanner implements Planner {
  private readonly config: AgentConfig;
  private readonly fallback: DeterministicPlanner;
  private readonly logger: Logger;

  constructor(config: AgentConfig, logger: Logger) {
    this.config = config;
    this.fallback = new DeterministicPlanner();
    this.logger = logger.child("ai-planner");
  }

  async planNextAction(context: PlanContext): Promise<PlannedAction> {
    if (this.config.provider === "none") {
      return this.fallback.planNextAction(context);
    }

    try {
      const prompt = buildPlannerPrompt(context);
      const output = await this.executeAgentProcess(prompt);
      const parsed = extractJsonFromOutput(output);
      const action = parsePlannedAction(parsed);

      this.logger.info("AI agent planned action successfully", {
        kind: action.kind,
        target: action.targetSemanticId,
        reason: action.reason,
      });

      return action;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        "AI Agent planning failed or returned invalid response; falling back to deterministic planner",
        {
          error: message,
        },
      );
      return this.fallback.planNextAction(context);
    }
  }

  private executeAgentProcess(inputPrompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeoutMs = this.config.timeoutMs;
      const command = this.config.command;
      const args = resolveDefaultAgentArgs(this.config);

      // Spawn external agent process
      const child = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          TERM: "xterm-256color",
        },
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
        reject(new Error(`AI Agent command timed out after ${timeoutMs}ms: ${command}`));
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) return;

        if (code !== 0) {
          reject(new Error(`Agent process exited with code ${code ?? "null"}: ${stderr.trim()}`));
          return;
        }

        resolve(stdout.trim());
      });

      child.stdin.write(inputPrompt);
      child.stdin.end();
    });
  }
}
