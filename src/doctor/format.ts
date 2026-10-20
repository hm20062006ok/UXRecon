import type { DoctorCheck, DoctorReport } from "./types.js";

const SYMBOLS: Record<DoctorCheck["status"], string> = {
  pass: "✔",
  warn: "⚠",
  fail: "✖",
  skip: "○",
};

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`UXRecon Doctor Report (${report.generatedAt})`);
  lines.push("=".repeat(50));

  for (const check of report.checks) {
    const symbol = SYMBOLS[check.status];
    const statusTag = check.status.toUpperCase().padEnd(4);
    lines.push(`[${statusTag}] ${symbol} ${check.title} (${check.id}) [${check.durationMs}ms]`);
    for (const detailLine of check.detail.split("\n")) {
      if (detailLine.trim().length > 0) {
        lines.push(`       ${detailLine.trim()}`);
      }
    }
    if (check.hint) {
      lines.push(`       Fix: ${check.hint}`);
    }
  }

  lines.push("-".repeat(50));
  const { pass, warn, fail, skip, ok } = report.summary;
  lines.push(`Summary: ${pass} passed, ${warn} warnings, ${fail} failed, ${skip} skipped`);
  lines.push(ok ? "All critical checks passed!" : "Some critical checks failed. Please see hints above.");

  return lines.join("\n");
}
