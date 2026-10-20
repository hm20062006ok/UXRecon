export {
  CONFIG_FILE_NAMES,
  SUPPORTED_SCHEMA_VERSION,
  type AppConfig,
  type AppiumConfig,
  type AgentConfig,
  type AgentProvider,
  type Config,
  type DeviceConfig,
  type ExplorationConfig,
  type LoadConfigOptions,
  type LoggingConfig,
  type RunConfig,
  type SafetyConfig,
} from "./types.js";

export {
  DEFAULT_CONFIRM_KEYWORDS,
  DEFAULT_DENY_KEYWORDS,
  configSchema,
  parseDocument,
  type ConfigDocument,
} from "./schema.js";

export {
  loadConfig,
  parseConfig,
  resolveConfigPath,
  substituteEnv,
  toSafeSnapshot,
  type ResolvedConfigPath,
} from "./load.js";
