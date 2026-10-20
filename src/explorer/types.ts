import type { RunSummary } from "../artifacts/types.js";

export interface ExplorerConfigOptions {
  maxPages?: number | undefined;
  maxActions?: number | undefined;
  maxDepth?: number | undefined;
  actionRetryLimit?: number | undefined;
  dryRun?: boolean | undefined;
}

export interface ExplorationRunResult {
  runId: string;
  status: "completed" | "interrupted" | "failed";
  summary: RunSummary;
  durationMs: number;
  stopReason: string;
}
