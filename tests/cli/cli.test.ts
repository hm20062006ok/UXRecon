import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/main.js";

describe("CLI entrypoint (runCli)", () => {
  it("shows help when --help is passed", async () => {
    const code = await runCli(["--help"]);
    expect(code).toBe(0);
  });

  it("shows help when no arguments are provided", async () => {
    const code = await runCli([]);
    expect(code).toBe(0);
  });

  it("returns error code for unknown command", async () => {
    const code = await runCli(["unknown-command"]);
    expect(code).toBe(1);
  });

  it("returns error code for unrecognized flag", async () => {
    const code = await runCli(["--non-existent-flag"]);
    expect(code).toBe(1);
  });

  it("returns error code when --config is missing its argument", async () => {
    const code = await runCli(["doctor", "--config"]);
    expect(code).toBe(1);
  });

  it("fails with actionable error when explore command cannot find config", async () => {
    const code = await runCli(["explore", "--config", "/non/existent/config.yaml"]);
    expect(code).toBeGreaterThan(0);
  });
});
