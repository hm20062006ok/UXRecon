import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLogger,
  createRedactor,
  createSilentLogger,
  maskIdentifier,
  type LogFields,
  type LogLevel,
} from "../../src/logging/index.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "uxr-logging-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

const FIXED_DATE = new Date("2026-10-20T12:00:00.000Z");
const FIXED_NOW = (): Date => FIXED_DATE;

describe("StructuredLogger", () => {
  it("defaults to info level and phase app", () => {
    const lines: string[] = [];
    const logger = createLogger({
      write: (line) => lines.push(line),
      now: FIXED_NOW,
    });

    expect(logger.phase).toBe("app");

    logger.debug("debug message");
    logger.info("info message");
    logger.warn("warn message");
    logger.error("error message");

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("2026-10-20T12:00:00.000Z INFO  [app] info message");
    expect(lines[1]).toBe("2026-10-20T12:00:00.000Z WARN  [app] warn message");
    expect(lines[2]).toBe("2026-10-20T12:00:00.000Z ERROR [app] error message");
  });

  it("filters messages based on configured log level", () => {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];

    for (const level of levels) {
      const lines: string[] = [];
      const logger = createLogger({
        level,
        write: (line) => lines.push(line),
        now: FIXED_NOW,
      });

      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      if (level === "debug") {
        expect(lines).toHaveLength(4);
      } else if (level === "info") {
        expect(lines).toHaveLength(3);
        expect(lines.some((l) => l.includes("DEBUG"))).toBe(false);
      } else if (level === "warn") {
        expect(lines).toHaveLength(2);
        expect(lines.every((l) => l.includes("WARN") || l.includes("ERROR"))).toBe(true);
      } else if (level === "error") {
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("ERROR");
      }
    }
  });

  it("formats log fields and escapes spaces and quotes in terminal output", () => {
    const lines: string[] = [];
    const logger = createLogger({
      write: (line) => lines.push(line),
      now: FIXED_NOW,
      phase: "runner",
    });

    logger.info("action completed", {
      action: "tap",
      target: "Sign In Button",
      escaped: 'quote"test',
      count: 42,
      ok: true,
      data: { nested: 1 },
      list: [1, 2],
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      '2026-10-20T12:00:00.000Z INFO  [runner] action completed action=tap target="Sign In Button" escaped="quote\\"test" count=42 ok=true data={"nested":1} list=[1,2]',
    );
  });

  it("uses process.stderr and system clock by default", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const logger = createLogger();
      logger.info("default configuration message");
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = String(stderrSpy.mock.calls[0]?.[0] ?? "");
      expect(output).toContain("INFO  [app] default configuration message\n");
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

describe("child logger", () => {
  it("inherits level, sink, and clock while overriding phase and merging fields", () => {
    const lines: string[] = [];
    const parent = createLogger({
      phase: "root",
      level: "warn",
      write: (line) => lines.push(line),
      now: FIXED_NOW,
    });

    const child = parent.child("worker", { workerId: 1, shared: "parent" });
    expect(child.phase).toBe("worker");

    child.debug("child debug"); // suppressed by inherited level warn
    child.info("child info"); // suppressed by inherited level warn
    child.warn("child warning", { shared: "child-override", extra: "extra-val" });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      "2026-10-20T12:00:00.000Z WARN  [worker] child warning workerId=1 shared=child-override extra=extra-val",
    );
  });

  it("accumulates base fields through multiple generations of children", () => {
    const lines: string[] = [];
    const root = createLogger({
      phase: "level0",
      write: (line) => lines.push(line),
      now: FIXED_NOW,
    });

    const gen1 = root.child("level1", { a: 1 });
    const gen2 = gen1.child("level2", { b: 2 });
    const gen3 = gen2.child("level3", { c: 3, a: 100 });

    gen3.info("deep log");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("2026-10-20T12:00:00.000Z INFO  [level3] deep log a=100 b=2 c=3");
  });
});

describe("JSONL logging", () => {
  it("automatically creates parent directories and synchronously appends JSONL records", () => {
    const tempDir = makeTempDir();
    const jsonlPath = path.join(tempDir, "logs", "nested", "run.jsonl");

    const logger = createLogger({
      phase: "observer",
      jsonlPath,
      write: () => undefined,
      now: FIXED_NOW,
    });

    logger.info("first message", { step: 1 });
    logger.debug("filtered out"); // filtered by default level info
    logger.warn("second message", { step: 2, status: "pending" });

    const content = readFileSync(jsonlPath, "utf8");
    const rawLines = content.trim().split("\n");
    expect(rawLines).toHaveLength(2);

    const record1 = JSON.parse(rawLines[0]!) as LogFields;
    expect(record1).toEqual({
      ts: "2026-10-20T12:00:00.000Z",
      level: "info",
      phase: "observer",
      msg: "first message",
      step: 1,
    });

    const record2 = JSON.parse(rawLines[1]!) as LogFields;
    expect(record2).toEqual({
      ts: "2026-10-20T12:00:00.000Z",
      level: "warn",
      phase: "observer",
      msg: "second message",
      step: 2,
      status: "pending",
    });
  });

  it("inherits jsonlPath in child loggers", () => {
    const tempDir = makeTempDir();
    const jsonlPath = path.join(tempDir, "child.jsonl");

    const parent = createLogger({
      phase: "parent",
      jsonlPath,
      write: () => undefined,
      now: FIXED_NOW,
    });

    const child = parent.child("child", { parentId: 42 });
    child.info("child event", { eventId: 99 });

    const lines = readFileSync(jsonlPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as LogFields;
    expect(parsed).toEqual({
      ts: "2026-10-20T12:00:00.000Z",
      level: "info",
      phase: "child",
      msg: "child event",
      parentId: 42,
      eventId: 99,
    });
  });
});

describe("Redactor and maskIdentifier", () => {
  describe("maskIdentifier", () => {
    it("masks identifiers longer than or equal to 16 characters keeping 8 prefix and 6 suffix chars", () => {
      // 40-char hex UDID
      const hex40 = "0123456789abcdef0123456789abcdef01234567";
      expect(maskIdentifier(hex40)).toBe("01234567…234567");

      // 36-char UDID / UUID
      const uuid36 = "00008110-001544EC36A1801E1234567890";
      expect(maskIdentifier(uuid36)).toBe("00008110…567890");

      // Exactly 16 chars
      const sixteen = "12345678ABCDEFGH";
      expect(maskIdentifier(sixteen)).toBe("12345678…CDEFGH");
    });

    it("fully masks identifiers shorter than 16 characters", () => {
      expect(maskIdentifier("short-udid")).toBe("***");
      expect(maskIdentifier("")).toBe("***");
      expect(maskIdentifier("123456789012345")).toBe("***");
    });
  });

  describe("default redaction rules", () => {
    it("redacts values under sensitive keys matching FULL_REDACT_KEY", () => {
      const redactor = createRedactor();
      const input = {
        secret: "my-secret-value",
        api_key: "api-12345",
        apiKey: "api-67890",
        password: "supersecretpassword",
        passphrase: "mnemonic-phrase",
        token: "bearer-token-val",
        authorization: "Bearer eyJhbGciOi...",
        cookie: "session=abcdef",
        credential: "cred",
        private_key: "key-data",
        seed: "12 words",
        mnemonic: "apple banana cherry",
        nested: {
          token: "nested-token",
          normal: "safe-text",
        },
      };

      const result = redactor.redactValue(input) as Record<string, unknown>;
      expect(result.secret).toBe("***");
      expect(result.api_key).toBe("***");
      expect(result.apiKey).toBe("***");
      expect(result.password).toBe("***");
      expect(result.passphrase).toBe("***");
      expect(result.token).toBe("***");
      expect(result.authorization).toBe("***");
      expect(result.cookie).toBe("***");
      expect(result.credential).toBe("***");
      expect(result.private_key).toBe("***");
      expect(result.seed).toBe("***");
      expect(result.mnemonic).toBe("***");
      expect((result.nested as Record<string, unknown>).token).toBe("***");
      expect((result.nested as Record<string, unknown>).normal).toBe("safe-text");
    });

    it("partially masks values under keys matching PARTIAL_REDACT_KEY", () => {
      const redactor = createRedactor();
      const input = {
        udid: "00008110-001544EC36A1801E",
        serial: "C02G1234567890AB",
        ecid: "0011223344556677",
        device_id: "DEVICE-1234567890123",
        deviceId: "DEVICE-1234567890123",
        shortUdid: "abc",
        nonStringUdid: 12345,
      };

      const result = redactor.redactValue(input) as Record<string, unknown>;
      expect(result.udid).toBe("00008110…A1801E");
      expect(result.serial).toBe("C02G1234…7890AB");
      expect(result.ecid).toBe("00112233…556677");
      expect(result.device_id).toBe("DEVICE-1…890123");
      expect(result.deviceId).toBe("DEVICE-1…890123");
      expect(result.shortUdid).toBe("***");
      expect(result.nonStringUdid).toBe(12345);
    });

    it("redacts Error objects without losing error name", () => {
      const redactor = createRedactor({
        patterns: [/secret-code-\d+/g],
      });
      const error = new Error("Failed with secret-code-1234");
      const result = redactor.redactValue(error) as { name: string; message: string };

      expect(result.name).toBe("Error");
      expect(result.message).toBe("Failed with ***");
    });

    it("safely handles circular references and depth limits", () => {
      const redactor = createRedactor();

      const circular: Record<string, unknown> = { name: "cycle" };
      circular.self = circular;

      const result = redactor.redactValue(circular) as Record<string, unknown>;
      expect(result.name).toBe("cycle");
      expect(result.self).toBe("[circular]");

      // Deep nesting exceeding MAX_DEPTH (6)
      let deep: Record<string, unknown> = { level: 7 };
      for (let i = 6; i >= 0; i -= 1) {
        deep = { child: deep };
      }
      const deepResult = redactor.redactValue(deep) as Record<string, unknown>;
      // Traverse down 6 levels
      let current = deepResult;
      for (let i = 0; i < 6; i += 1) {
        current = current.child as Record<string, unknown>;
      }
      expect(current).toBe("[depth-limit]");
    });
  });

  describe("custom patterns redaction", () => {
    it("redacts matching substrings in plain text and values", () => {
      const redactor = createRedactor({
        patterns: [/sk-[a-zA-Z0-9]{10,}/, /0000[0-9]{4}-[0-9A-F]{16}/],
      });

      const message = "Connecting to device 00008110-001544EC36A1801E with key sk-abcdef1234567890";
      expect(redactor.redactText(message)).toBe("Connecting to device *** with key ***");

      const obj = {
        details: "Using key sk-1234567890abcdef",
        unmatched: "hello world",
      };
      const redactedObj = redactor.redactValue(obj) as Record<string, unknown>;
      expect(redactedObj.details).toBe("Using key ***");
      expect(redactedObj.unmatched).toBe("hello world");
    });

    it("resets regex lastIndex so stateful /g regexes match repeatedly across calls", () => {
      const globalRegex = /TOKEN-\d+/g;
      const redactor = createRedactor({ patterns: [globalRegex] });

      expect(redactor.redactText("First TOKEN-1")).toBe("First ***");
      expect(redactor.redactText("Second TOKEN-2")).toBe("Second ***");
      expect(redactor.redactText("Third TOKEN-3")).toBe("Third ***");
    });
  });

  describe("logger integration with redactor", () => {
    it("redacts secrets in log messages and fields in both console and JSONL", () => {
      const tempDir = makeTempDir();
      const jsonlPath = path.join(tempDir, "redacted.jsonl");
      const lines: string[] = [];

      const redactor = createRedactor({
        patterns: [/SECRET-\d+/g],
      });

      const logger = createLogger({
        write: (line) => lines.push(line),
        jsonlPath,
        redactor,
        now: FIXED_NOW,
      });

      logger.info("Executing task with SECRET-999", {
        password: "cleartext-pass",
        udid: "00008110-001544EC36A1801E",
        safeParam: "SECRET-12345-value",
      });

      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(
        "2026-10-20T12:00:00.000Z INFO  [app] Executing task with *** password=*** udid=00008110…A1801E safeParam=***-value",
      );

      const jsonlContent = readFileSync(jsonlPath, "utf8").trim();
      const record = JSON.parse(jsonlContent) as LogFields;
      expect(record.msg).toBe("Executing task with ***");
      expect(record.password).toBe("***");
      expect(record.udid).toBe("00008110…A1801E");
      expect(record.safeParam).toBe("***-value");
    });
  });
});

describe("non-standard and exceptional field values", () => {
  it("renders undefined, symbol, bigint, null, and unserializable values gracefully in terminal and JSONL", () => {
    const tempDir = makeTempDir();
    const jsonlPath = path.join(tempDir, "non-standard.jsonl");
    const lines: string[] = [];

    const logger = createLogger({
      write: (line) => lines.push(line),
      jsonlPath,
      now: FIXED_NOW,
    });

    const fn = (): void => undefined;
    const sym = Symbol("custom-symbol");
    const big = 9007199254740993n;
    const throwingObj = {
      toJSON() {
        throw new Error("Cannot serialize");
      },
    };

    logger.info("testing unusual values", {
      und: undefined,
      nullVal: null,
      sym,
      big,
      fn,
      throwing: throwingObj,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("und=undefined");
    expect(lines[0]).toContain("nullVal=null");
    expect(lines[0]).toContain("sym=Symbol(custom-symbol)");
    expect(lines[0]).toContain("big=9007199254740993");
    expect(lines[0]).toContain("fn=[unserializable]");
    expect(lines[0]).toContain("throwing=[unserializable]");

    // Verify JSONL wrote successfully without throwing on BigInt or Symbol
    const fileContent = readFileSync(jsonlPath, "utf8").trim();
    const jsonRecord = JSON.parse(fileContent) as LogFields;
    expect(jsonRecord.msg).toBe("testing unusual values");
    expect(jsonRecord.nullVal).toBeNull();
    expect(jsonRecord.big).toBe("9007199254740993");
    expect(jsonRecord.sym).toBe("Symbol(custom-symbol)");
  });
});

describe("createSilentLogger", () => {
  it("creates a logger that produces no output on any log level", () => {
    const logger = createSilentLogger();

    // Verify calling all log methods does not throw or fail
    expect(() => {
      logger.debug("debug");
      logger.info("info");
      logger.warn("warn");
      logger.error("error");
    }).not.toThrow();

    const child = logger.child("subtask", { extra: "field" });
    expect(() => {
      child.debug("child debug");
      child.info("child info");
      child.warn("child warn");
      child.error("child error");
    }).not.toThrow();
  });
});
