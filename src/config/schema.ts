import { z } from "zod";
import { AppError } from "../errors/index.js";
import { SUPPORTED_SCHEMA_VERSION, type Config } from "./types.js";

/**
 * Default keywords. All default restrictions (7.1 default deny and 7.2 must confirm)
 * have been removed as requested. These lists default to empty, allowing unrestricted
 * exploration unless users explicitly configure custom deny/confirm keywords.
 */
export const DEFAULT_DENY_KEYWORDS: readonly string[] = [] as const;

export const DEFAULT_CONFIRM_KEYWORDS: readonly string[] = [] as const;

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const deviceSchema = z.strictObject({
  udid: z.string().min(1, "device.udid must be a non-empty device UDID"),
  name: z.string().min(1).default("iPhone"),
  platformVersion: z.string().min(1, 'device.platformVersion must be set, e.g. "27.0"'),
});

const appSchema = z.strictObject({
  bundleId: z.string().min(1, "app.bundleId must be a non-empty bundle identifier"),
});

const appiumSchema = z.strictObject({
  host: z.string().min(1).default("127.0.0.1"),
  port: z.number().int().min(1).max(65535).default(4723),
  basePath: z.string().startsWith("/").default("/"),
  webDriverAgentUrl: z.string().min(1).nullable().default(null),
  xcodeOrgId: z.string().default(""),
  xcodeSigningId: z.string().min(1).default("Apple Development"),
  updatedWDABundleId: z.string().default(""),
  allowProvisioningDeviceRegistration: z.boolean().default(false),
  wdaLaunchTimeoutMs: z.number().int().min(1000).default(120_000),
  wdaConnectionTimeoutMs: z.number().int().min(1000).default(120_000),
  newCommandTimeoutSec: z.number().int().min(10).default(180),
});

const safetySchema = z.strictObject({
  allowSafeTap: z.boolean().default(true),
  denyKeywords: z.array(z.string()).default([...DEFAULT_DENY_KEYWORDS]),
  confirmKeywords: z.array(z.string()).default([...DEFAULT_CONFIRM_KEYWORDS]),
  redactPatterns: z
    .array(z.string())
    .default([])
    .refine(
      (patterns) => patterns.every((pattern) => isCompilableRegExp(pattern)),
      "safety.redactPatterns must contain valid regular expression sources",
    ),
});

const agentProviderSchema = z.enum(["codex", "claude", "gemini", "opencode", "custom", "none"]);

const agentSchema = z.strictObject({
  provider: agentProviderSchema.default("codex"),
  command: z.string().min(1).default("codex"),
  model: z.string().min(1).nullable().default(null),
  args: z.array(z.string()).default([]),
  timeoutMs: z.number().int().min(1000).default(60_000),
});

const explorationSchema = z.strictObject({
  dryRun: z.boolean().default(true),
  maxPages: z.number().int().min(1).max(1000).default(50),
  maxActions: z.number().int().min(1).max(10_000).default(500),
  maxDepth: z.number().int().min(1).max(20).default(6),
  actionRetryLimit: z.number().int().min(0).max(5).default(2),
  scrollLimit: z.number().int().min(1).max(100).default(10),
});

const runSchema = z.strictObject({
  outputDir: z.string().min(1).default("runs"),
  project: z.string().min(1).default("default"),
});

const loggingSchema = z.strictObject({
  level: logLevelSchema.default("info"),
  jsonl: z.boolean().default(true),
});

function isCompilableRegExp(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

/**
 * The schema output is deliberately assignable to the hand-written `Config`
 * interface in types.ts; `parseDocument` returning `Config` makes TypeScript
 * fail the build if the two ever drift apart.
 *
 * `device` and `app` have no section default: a missing section must surface as
 * a "required field" error, which load.ts raises before validation runs.
 */
export const configSchema = z
  .strictObject({
    schemaVersion: z.literal(SUPPORTED_SCHEMA_VERSION).default(SUPPORTED_SCHEMA_VERSION),
    device: deviceSchema,
    app: appSchema,
    appium: appiumSchema.prefault({}),
    safety: safetySchema.prefault({}),
    exploration: explorationSchema.prefault({}),
    agent: agentSchema.prefault({}),
    run: runSchema.prefault({}),
    logging: loggingSchema.prefault({}),
  })
  .superRefine((value, ctx) => {
    // Signing identifiers only matter when we have to build WebDriverAgent ourselves.
    if (value.appium.webDriverAgentUrl !== null) return;
    if (value.appium.xcodeOrgId.trim() === "") {
      ctx.addIssue({
        code: "custom",
        path: ["appium", "xcodeOrgId"],
        message:
          "appium.xcodeOrgId is required unless appium.webDriverAgentUrl points at an already-running WDA " +
          "(find the team id in Xcode → Signing & Capabilities)",
      });
    }
    if (value.appium.updatedWDABundleId.trim() === "") {
      ctx.addIssue({
        code: "custom",
        path: ["appium", "updatedWDABundleId"],
        message:
          "appium.updatedWDABundleId is required unless appium.webDriverAgentUrl is set " +
          "(use a unique id such as com.yourname.uxrecon.WebDriverAgentRunner)",
      });
    }
  });

export type ConfigDocument = z.infer<typeof configSchema>;

/** Parses an already-substituted YAML document. Throws AppError on any problem. */
export function parseDocument(document: unknown, source: string): Config {
  const result = configSchema.safeParse(document);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  - ${path}: ${issue.message}`;
    })
    .join("\n");
  throw new AppError("UXR-CFG-003", `Invalid configuration in ${source}:\n${issues}`, {
    exitCode: 2,
    context: { source },
  });
}
