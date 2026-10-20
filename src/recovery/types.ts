export type RecoveryLevel = "in-app-back" | "dismiss-modal" | "app-relaunch" | "human-intervention";

export interface RecoveryResult {
  recovered: boolean;
  level: RecoveryLevel;
  attempts: number;
  similarity: number;
  error?: string | undefined;
}
