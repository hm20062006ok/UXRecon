import type { Config } from "../config/types.js";
import type { Logger } from "../logging/index.js";
import { AiAgentPlanner } from "./agent.js";
import { DeterministicPlanner } from "./deterministic.js";
import type { Planner } from "./types.js";

export function createPlanner(config: Config, logger: Logger): Planner {
  if (config.agent.provider === "none") {
    return new DeterministicPlanner();
  }
  return new AiAgentPlanner(config.agent, logger);
}

export * from "./types.js";
export * from "./schema.js";
export * from "./prompt.js";
export * from "./deterministic.js";
export * from "./agent.js";
