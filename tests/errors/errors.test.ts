import { describe, expect, it } from "vitest";
import { errorCatalog, type ErrorCode } from "../../src/errors/catalog.js";
import { AppError, describeError, isAppError, toAppError } from "../../src/errors/index.js";

describe("AppError", () => {
  it("constructs with default options from errorCatalog", () => {
    const error = new AppError("UXR-CFG-001", "Config file was not found at specified path");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe("AppError");
    expect(error.code).toBe("UXR-CFG-001");
    expect(error.message).toBe("Config file was not found at specified path");
    expect(error.title).toBe("Configuration file not found");
    expect(error.hint).toBe("Pass --config <path>, or copy config.example.yaml to config.yaml.");
    expect(error.exitCode).toBe(1);
    expect(error.context).toEqual({});
    expect(error.cause).toBeUndefined();
  });

  it("accepts custom hint, exitCode, context, and cause", () => {
    const underlyingCause = new Error("ENOENT: no such file or directory");
    const customContext = { path: "/custom/path/config.yaml", attempts: 3 };

    const error = new AppError("UXR-CFG-001", "Could not load configuration", {
      hint: "Check directory permissions or pass --config with a valid path.",
      exitCode: 2,
      context: customContext,
      cause: underlyingCause,
    });

    expect(error.code).toBe("UXR-CFG-001");
    expect(error.message).toBe("Could not load configuration");
    expect(error.title).toBe("Configuration file not found");
    expect(error.hint).toBe("Check directory permissions or pass --config with a valid path.");
    expect(error.exitCode).toBe(2);
    expect(error.context).toEqual(customContext);
    expect(error.cause).toBe(underlyingCause);
  });
});

describe("isAppError", () => {
  it("returns true only for AppError instances", () => {
    expect(isAppError(new AppError("UXR-INT-001", "Internal error"))).toBe(true);

    expect(isAppError(new Error("Standard error"))).toBe(false);
    expect(isAppError(new TypeError("Type error"))).toBe(false);
    expect(isAppError({ name: "AppError", code: "UXR-INT-001", message: "Fake" })).toBe(false);
    expect(isAppError("UXR-INT-001")).toBe(false);
    expect(isAppError(123)).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
  });
});

describe("toAppError", () => {
  it("returns existing AppError unchanged", () => {
    const original = new AppError("UXR-DEV-001", "No iPhone found", { exitCode: 5 });
    const converted = toAppError(original);

    expect(converted).toBe(original);
    expect(converted.code).toBe("UXR-DEV-001");
    expect(converted.exitCode).toBe(5);
  });

  it("converts a standard Error into an AppError with default fallback UXR-INT-001", () => {
    const native = new Error("Connection reset by peer");
    const converted = toAppError(native);

    expect(converted).toBeInstanceOf(AppError);
    expect(converted.code).toBe("UXR-INT-001");
    expect(converted.message).toBe("Connection reset by peer");
    expect(converted.cause).toBe(native);
    expect(converted.exitCode).toBe(1);
    expect(converted.hint).toBe(errorCatalog["UXR-INT-001"].hint);
  });

  it("converts a standard Error into an AppError with custom fallback code", () => {
    const native = new Error("Appium port 4723 refused connection");
    const converted = toAppError(native, "UXR-DEV-002");

    expect(converted).toBeInstanceOf(AppError);
    expect(converted.code).toBe("UXR-DEV-002");
    expect(converted.message).toBe("Appium port 4723 refused connection");
    expect(converted.cause).toBe(native);
    expect(converted.title).toBe("Appium server unreachable");
  });

  it("converts non-Error values (strings, numbers, objects) and preserves value in cause", () => {
    const stringError = toAppError("fatal string error", "UXR-CFG-002");
    expect(stringError).toBeInstanceOf(AppError);
    expect(stringError.code).toBe("UXR-CFG-002");
    expect(stringError.message).toBe("fatal string error");
    expect(stringError.cause).toBe("fatal string error");

    const numberError = toAppError(404);
    expect(numberError).toBeInstanceOf(AppError);
    expect(numberError.code).toBe("UXR-INT-001");
    expect(numberError.message).toBe("404");
    expect(numberError.cause).toBe(404);

    const obj = { error: "failed", status: 500 };
    const objectError = toAppError(obj);
    expect(objectError).toBeInstanceOf(AppError);
    expect(objectError.code).toBe("UXR-INT-001");
    expect(objectError.message).toBe("[object Object]");
    expect(objectError.cause).toBe(obj);

    const nullError = toAppError(null);
    expect(nullError.message).toBe("null");
    expect(nullError.cause).toBeNull();

    const undefinedError = toAppError(undefined);
    expect(undefinedError.message).toBe("undefined");
    expect(undefinedError.cause).toBeUndefined();
  });
});

describe("describeError", () => {
  it("renders a 3-line description without context", () => {
    const error = new AppError("UXR-DEV-003", "Bundle com.example.app was not found on device");
    const output = describeError(error);

    expect(output).toBe(
      [
        "UXR-DEV-003 Target app is not installed",
        "  Bundle com.example.app was not found on device",
        "  Fix: Install the app on the device, or correct app.bundleId.",
      ].join("\n"),
    );
  });

  it("renders a 4-line description with context when present", () => {
    const error = new AppError("UXR-CFG-003", "Configuration failed validation", {
      context: {
        field: "device.udid",
        expected: "string",
      },
    });
    const output = describeError(error);

    expect(output).toBe(
      [
        "UXR-CFG-003 Configuration failed validation",
        "  Configuration failed validation",
        "  Fix: Each issue below names the field and what was expected. Compare with config.example.yaml.",
        "  Context: field=device.udid expected=string",
      ].join("\n"),
    );
  });
});

describe("errorCatalog", () => {
  it("has valid title and hint for every defined error code", () => {
    const codes = Object.keys(errorCatalog) as ErrorCode[];
    expect(codes.length).toBeGreaterThan(0);

    for (const code of codes) {
      const def = errorCatalog[code];
      expect(code).toMatch(/^UXR-[A-Z]{3}-\d{3}$/);
      expect(typeof def.title).toBe("string");
      expect(def.title.trim().length).toBeGreaterThan(0);
      expect(typeof def.hint).toBe("string");
      expect(def.hint.trim().length).toBeGreaterThan(0);
    }
  });

  it("contains all expected catalog error codes", () => {
    const expectedCodes: ErrorCode[] = [
      "UXR-CFG-001",
      "UXR-CFG-002",
      "UXR-CFG-003",
      "UXR-CFG-004",
      "UXR-CFG-005",
      "UXR-DEV-001",
      "UXR-DEV-002",
      "UXR-DEV-003",
      "UXR-DOC-001",
      "UXR-CLI-001",
      "UXR-CLI-002",
      "UXR-INT-001",
    ];

    for (const code of expectedCodes) {
      expect(errorCatalog).toHaveProperty(code);
    }
  });
});
