/**
 * Core data contracts for iPhone UX Explorer.
 * Versioned schema contracts shared across device observation, state detection,
 * safety guardrails, exploration graph, planner, and artifact generator.
 */

export const CONTRACTS_SCHEMA_VERSION = 1;

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LocatorStrategy = "accessibility_id" | "predicate" | "class_chain" | "xpath";

export interface LocatorCandidate {
  strategy: LocatorStrategy;
  selector: string;
  confidence: number;
}

export type ActionKind =
  "tap" | "type" | "clear" | "scroll" | "back" | "dismiss_keyboard" | "handle_alert" | "ask_user" | "stop";

export type ElementSource = "accessibility" | "ocr" | "vision";

export interface UIElement {
  /** Stable within a single observation */
  elementId: string;
  /** Semantic id intended to be stable across observations of the same logical control */
  semanticId: string;
  type: string;
  label: string;
  name: string;
  value: string;
  bounds: ElementBounds;
  enabled: boolean;
  visible: boolean;
  selected: boolean;
  locatorCandidates: LocatorCandidate[];
  possibleActions: ActionKind[];
  source: ElementSource;
  confidence: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export type DeviceOrientation =
  "PORTRAIT" | "LANDSCAPE" | "UIA_DEVICE_ORIENTATION_PORTRAITHOMEDOWN" | (string & {});

export interface Observation {
  schemaVersion: 1;
  observationId: string;
  capturedAt: string;
  screenshotPath: string;
  pageSourcePath: string;
  appId: string;
  orientation: DeviceOrientation;
  viewport: Viewport;
  elements: UIElement[];
  keyboardVisible: boolean;
  systemAlert: boolean;
  captureWarnings: string[];
}

export type ActionRisk = "low" | "medium" | "high" | "forbidden";

export interface PlannedAction {
  kind: ActionKind;
  targetElementId?: string | undefined;
  targetSemanticId?: string | undefined;
  /** Text payload or input purpose without secret data */
  inputText?: string | undefined;
  inputPurpose?: string | undefined;
  direction?: "up" | "down" | "left" | "right" | undefined;
  reason: string;
  expectedEffect: string;
  risk: ActionRisk;
  confidence: number;
}

export type PageStatus = "new" | "exploring" | "complete" | "blocked";

export interface PageFingerprints {
  /** Strict fingerprint based on type, stable text, visibility, bounds buckets */
  exact: string;
  /** Structural fingerprint ignoring volatile numbers, clocks, timestamps, balances */
  structural: string;
  /** Perceptual hash or visual signature if available */
  visual?: string | undefined;
}

export interface PageState {
  pageId: string;
  fingerprints: PageFingerprints;
  observationId: string;
  interactiveElements: UIElement[];
  visitedActionKeys: string[];
  pendingActionKeys: string[];
  parentTransitionId?: string | undefined;
  status: PageStatus;
  firstSeenAt: string;
  lastVisitedAt: string;
}

export type TransitionResult = "changed" | "no_change" | "failed" | "blocked" | "cancelled";

export interface Transition {
  transitionId: string;
  fromPageId: string;
  toPageId: string;
  action: PlannedAction;
  actionKey: string;
  beforeObservationId: string;
  afterObservationId?: string | undefined;
  startedAt: string;
  durationMs: number;
  result: TransitionResult;
  error?: string | undefined;
  recovery?: string | undefined;
  uxObservations: string[];
}
