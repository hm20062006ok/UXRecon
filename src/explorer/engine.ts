import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  auditPageUx,
  extractDesignTokens,
  generateGalleryHtml,
  generateReplicationBlueprint,
  generateScreenSpec,
} from "../analysis/index.js";
import type { Config } from "../config/types.js";
import type { DeviceAdapter } from "../device/types.js";
import type { Logger } from "../logging/index.js";
import { filterInteractiveElements, parsePageSource } from "../observation/index.js";
import { createPlanner, type Planner } from "../planner/index.js";
import { RecoveryLadder } from "../recovery/index.js";
import {
  BoundaryGuard,
  defaultRejectConfirmHandler,
  generateSmartFormValue,
  promptUserForFormField,
  SafetyRulesEngine,
  type ConfirmHandler,
} from "../safety/index.js";
import { generateScreenshotFilename, RunContext } from "../artifacts/index.js";
import { StateRegistry } from "../state/registry.js";
import { actionKeyFromPlannedAction } from "../state/action-key.js";
import type { Observation, PageState, PlannedAction, Transition, UIElement } from "../types/contracts.js";
import type { ExplorationRunResult, ExplorerConfigOptions } from "./types.js";

export class RecursiveExplorer {
  private readonly config: Config;
  private readonly device: DeviceAdapter;
  private readonly logger: Logger;
  private readonly runContext: RunContext;
  private readonly registry: StateRegistry;
  private readonly safety: SafetyRulesEngine;
  private readonly boundary: BoundaryGuard;
  private readonly recovery: RecoveryLadder;
  private readonly planner: Planner;
  private readonly confirmHandler: ConfirmHandler;

  private readonly maxPages: number;
  private readonly maxActions: number;
  private readonly maxDepth: number;
  private readonly startActions: string[];
  private readonly goal?: string | undefined;

  private actionSequence = 0;
  private isInterrupted = false;

  private readonly transitions: Transition[] = [];
  private readonly pageElementsMap: Map<string, UIElement[]> = new Map();
  private readonly observationMap: Map<string, Observation> = new Map();
  private readonly actionHistory: Array<{
    action: string;
    target?: string | undefined;
    reason?: string | undefined;
  }> = [];
  private lastViewport = { width: 393, height: 852 };

  constructor(
    config: Config,
    device: DeviceAdapter,
    logger: Logger,
    options: ExplorerConfigOptions = {},
    customConfirmHandler?: ConfirmHandler,
  ) {
    this.config = config;
    this.device = device;
    this.logger = logger.child("explorer");
    this.runContext = new RunContext(config);
    this.registry = new StateRegistry();
    this.safety = new SafetyRulesEngine(config.safety);
    this.boundary = new BoundaryGuard(config.app.bundleId);
    this.recovery = new RecoveryLadder(config.app.bundleId, logger);
    this.planner = createPlanner(config, logger);
    this.confirmHandler = customConfirmHandler ?? defaultRejectConfirmHandler;

    this.maxPages = options.maxPages ?? config.exploration.maxPages;
    this.maxActions = options.maxActions ?? config.exploration.maxActions;
    this.maxDepth = options.maxDepth ?? config.exploration.maxDepth;
    this.startActions = options.startActions ?? config.exploration.startActions ?? [];
    this.goal = options.goal ?? config.exploration.goal;
  }

  interrupt(): void {
    this.isInterrupted = true;
    this.logger.warn("Exploration interrupted by user/signal");
  }

  async run(): Promise<ExplorationRunResult> {
    const startTime = Date.now();
    this.logger.info("Starting exploration run", {
      runId: this.runContext.runId,
      maxPages: this.maxPages,
      maxActions: this.maxActions,
      maxDepth: this.maxDepth,
      dryRun: this.config.exploration.dryRun,
      startActions: this.startActions,
      goal: this.goal,
    });

    try {
      await this.device.connect();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Failed to connect to device", { error: message });
      this.runContext.finish("failed", message);
      return {
        runId: this.runContext.runId,
        status: "failed",
        summary: this.runContext.getSummary(),
        durationMs: Date.now() - startTime,
        stopReason: `Device connection failure: ${message}`,
      };
    }

    // Optional bootstrap navigation to user-specified starting page
    if (this.startActions.length > 0 && !this.config.exploration.dryRun) {
      this.logger.info("Executing bootstrap start actions to reach target initial page", {
        actions: this.startActions,
      });

      for (const targetText of this.startActions) {
        if (this.isInterrupted) break;
        try {
          const xml = await this.device.getPageSource().catch(() => "");
          const parsed = parsePageSource(xml);
          const match = parsed.elements.find((el) => {
            const combined = `${el.label} ${el.name} ${el.value}`.toLowerCase();
            return combined.includes(targetText.toLowerCase());
          });

          if (match) {
            this.logger.info(`Bootstrapping: tapping "${targetText}"`, { elementId: match.elementId });
            await this.device.tap(match);
            await new Promise((r) => setTimeout(r, 2000));
          } else {
            this.logger.warn(`Bootstrap start action target "${targetText}" not found on current screen`);
          }
        } catch (err) {
          this.logger.warn(`Failed during bootstrap action "${targetText}"`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const pageStack: PageState[] = [];
    let stopReason = "Completed exploration";

    this.actionSequence += 1;
    let currentObs = await this.captureObservation(this.actionSequence);

    try {
      while (!this.isInterrupted) {
        // 1. Check Limits
        const summary = this.runContext.getSummary();
        if (summary.pageCount >= this.maxPages) {
          stopReason = `Reached maximum page limit (${this.maxPages})`;
          break;
        }
        if (summary.transitionCount >= this.maxActions) {
          stopReason = `Reached maximum action limit (${this.maxActions})`;
          break;
        }

        // 2. Check Boundary
        const activeApp = await this.device.getActiveApp();
        const boundaryCheck = this.boundary.check(activeApp.bundleId);
        if (!boundaryCheck.allowed) {
          this.logger.warn("App boundary violation detected. Attempting to restart app.", {
            current: activeApp.bundleId,
            expected: this.config.app.bundleId,
          });
          await this.device.restartApp(this.config.app.bundleId);
          this.actionSequence += 1;
          currentObs = await this.captureObservation(this.actionSequence);
        }

        // 3. Current Screen Observation
        const obs = currentObs;
        const currentDepth = pageStack.length;

        // 4. Parse & Register Page
        const parsed = parsePageSource(await this.device.getPageSource().catch(() => ""));
        const interactive = filterInteractiveElements(parsed.elements, { viewport: obs.viewport });
        obs.elements = parsed.elements;
        const pageState = this.registry.registerObservation(obs, parsed.elements, interactive);
        this.pageElementsMap.set(pageState.pageId, parsed.elements);

        if (!pageStack.some((p) => p.pageId === pageState.pageId)) {
          pageStack.push(pageState);
          this.runContext.savePageState(pageState);
        }

        // 5. Plan Next Action
        const plannedAction = await this.planner.planNextAction({
          pageId: pageState.pageId,
          elements: parsed.elements,
          interactiveElements: interactive,
          visitedActionKeys: pageState.visitedActionKeys,
          pendingActionKeys: pageState.pendingActionKeys,
          screenshotPath: obs.screenshotPath,
          depth: currentDepth,
          maxDepth: this.maxDepth,
          goal: this.goal,
          actionHistory: this.actionHistory.slice(-5),
        });

        if (plannedAction.kind === "stop") {
          stopReason = plannedAction.reason;
          break;
        }

        // 6. Safety Evaluation & Target Element Resolution
        let targetElement: UIElement | undefined;
        if (plannedAction.targetElementId) {
          targetElement = parsed.elements.find((el) => el.elementId === plannedAction.targetElementId);
        }
        if (!targetElement && plannedAction.targetSemanticId) {
          targetElement = parsed.elements.find((el) => el.semanticId === plannedAction.targetSemanticId);
        }
        if (!targetElement && (plannedAction.targetElementId || plannedAction.targetSemanticId)) {
          const needle = (
            plannedAction.targetElementId ||
            plannedAction.targetSemanticId ||
            ""
          ).toLowerCase();
          targetElement = parsed.elements.find((el) => {
            const haystack = `${el.label} ${el.name} ${el.value}`.toLowerCase();
            return haystack.includes(needle);
          });
        }

        this.actionHistory.push({
          action: plannedAction.kind,
          target: targetElement?.label || plannedAction.targetElementId || plannedAction.targetSemanticId,
          reason: plannedAction.reason,
        });

        const safetyResult = this.safety.evaluate(plannedAction, targetElement);
        const actionKey = actionKeyFromPlannedAction(pageState.fingerprints.structural, plannedAction);

        if (safetyResult.decision === "forbidden" || safetyResult.decision === "deny") {
          this.logger.warn("Action blocked by safety policy", {
            decision: safetyResult.decision,
            reason: safetyResult.reason,
            action: plannedAction.kind,
          });
          pageState.visitedActionKeys.push(actionKey);
          this.recordTransition(
            pageState.pageId,
            pageState.pageId,
            plannedAction,
            actionKey,
            obs.observationId,
            "blocked",
            safetyResult.reason,
          );
          continue;
        }

        if (safetyResult.decision === "confirm") {
          const approved = await this.confirmHandler({
            action: plannedAction,
            target: targetElement,
            screenshotPath: obs.screenshotPath,
            reason: safetyResult.reason,
          });
          if (!approved) {
            this.logger.info("Action confirmation rejected by user", { action: plannedAction.kind });
            pageState.visitedActionKeys.push(actionKey);
            this.recordTransition(
              pageState.pageId,
              pageState.pageId,
              plannedAction,
              actionKey,
              obs.observationId,
              "cancelled",
              "User denied confirmation",
            );
            continue;
          }
        }

        // 7. Execute Action
        const execStart = Date.now();
        const execResult = await this.executeAction(plannedAction, targetElement);
        const execDuration = Date.now() - execStart;
        pageState.visitedActionKeys.push(actionKey);

        // 8. Observe Post-Action
        await new Promise((resolve) => setTimeout(resolve, 800));
        this.actionSequence += 1;
        const postObs = await this.captureObservation(this.actionSequence);
        const postParsed = parsePageSource(await this.device.getPageSource().catch(() => ""));
        const postInteractive = filterInteractiveElements(postParsed.elements, {
          viewport: postObs.viewport,
        });
        const postPageState = this.registry.registerObservation(
          postObs,
          postParsed.elements,
          postInteractive,
        );

        // Advance current observation for the next exploration step
        currentObs = postObs;

        // 9. Back Restoration Check (P8-T1)
        if (plannedAction.kind === "back") {
          pageStack.pop();
          const expectedParent = pageStack[pageStack.length - 1];
          if (expectedParent) {
            const restored = this.recovery.verifyRestoration(
              expectedParent.fingerprints.structural,
              postPageState.fingerprints.structural,
            );
            if (!restored) {
              await this.recovery.recover(this.device, expectedParent, postParsed.elements);
            }
          }
        }

        const transitionResult =
          postPageState.fingerprints.exact !== pageState.fingerprints.exact ? "changed" : "no_change";

        this.recordTransition(
          pageState.pageId,
          postPageState.pageId,
          plannedAction,
          actionKey,
          obs.observationId,
          execResult.success ? transitionResult : "failed",
          execResult.error,
          postObs.observationId,
          execDuration,
        );

        this.runContext.appendExplorationLog({
          step: this.actionSequence,
          action: plannedAction.kind,
          from: pageState.pageId,
          to: postPageState.pageId,
          result: transitionResult,
          durationMs: execDuration,
        });
      }
    } finally {
      await this.device.disconnect().catch(() => undefined);
    }

    this.generatePostExplorationArtifacts();

    const finalStatus = this.isInterrupted ? "interrupted" : "completed";
    this.runContext.finish(finalStatus, stopReason);

    return {
      runId: this.runContext.runId,
      status: finalStatus,
      summary: this.runContext.getSummary(),
      durationMs: Date.now() - startTime,
      stopReason,
    };
  }

  private async captureObservation(sequence: number): Promise<Observation> {
    const capturedAt = new Date().toISOString();
    const observationId = `obs-${String(sequence).padStart(6, "0")}`;

    const [screenshotBase64, xml, viewport, orientation] = await Promise.all([
      this.device.takeScreenshot(),
      this.device.getPageSource(),
      this.device.getViewport(),
      this.device.getOrientation(),
    ]);

    const filename = generateScreenshotFilename(sequence, "screen", "observe", "initial");
    const shotPath = this.runContext.saveScreenshot(filename, screenshotBase64);
    const xmlPath = this.runContext.savePageSource(observationId, xml);

    const obs: Observation = {
      schemaVersion: 1,
      observationId,
      capturedAt,
      screenshotPath: shotPath,
      pageSourcePath: xmlPath,
      appId: this.config.app.bundleId,
      orientation,
      viewport,
      elements: [],
      keyboardVisible: false,
      systemAlert: false,
      captureWarnings: [],
    };

    this.runContext.saveObservation(obs);
    this.observationMap.set(obs.observationId, obs);
    this.lastViewport = obs.viewport;
    return obs;
  }

  private async executeAction(
    action: PlannedAction,
    target?: UIElement,
  ): Promise<{ success: boolean; error?: string | undefined }> {
    switch (action.kind) {
      case "tap":
        return target ? this.device.tap(target) : { success: false, error: "Missing target element for tap" };
      case "type": {
        if (!target) {
          return { success: false, error: "Missing target element for type" };
        }
        const fieldLabel = target.label || target.name || target.value || "";
        const isPassword = target.type === "XCUIElementTypeSecureTextField";
        const textToType =
          action.inputText ?? generateSmartFormValue(fieldLabel, action.inputPurpose, isPassword);
        this.logger.info(`Auto-filling form input into "${fieldLabel || "field"}"`, {
          target: fieldLabel,
          textLength: textToType.length,
          purpose: action.inputPurpose,
        });
        return this.device.typeText(target, textToType);
      }
      case "ask_user": {
        if (!target) {
          return { success: false, error: "Missing target element for ask_user" };
        }
        const fieldName = target.label || target.name || target.value || "Form Field";
        const isPassword = target.type === "XCUIElementTypeSecureTextField";
        this.logger.info(`Prompting user for field input: "${fieldName}"`, { purpose: action.inputPurpose });
        const userInput = await promptUserForFormField(fieldName, action.inputPurpose, isPassword);
        return this.device.typeText(target, userInput);
      }
      case "clear":
        return target
          ? this.device.clearText(target)
          : { success: false, error: "Missing target element for clear" };
      case "scroll":
        return this.device.scroll(action.direction ?? "down");
      case "back":
        return this.device.back();
      case "dismiss_keyboard": {
        const ok = await this.device.dismissKeyboard();
        return { success: ok };
      }
      default:
        return { success: true };
    }
  }

  private recordTransition(
    fromPageId: string,
    toPageId: string,
    action: PlannedAction,
    actionKey: string,
    beforeObsId: string,
    result: Transition["result"],
    error?: string,
    afterObsId?: string,
    durationMs = 0,
  ): void {
    const transition: Transition = {
      transitionId: `trans-${String(this.actionSequence).padStart(6, "0")}`,
      fromPageId,
      toPageId,
      action,
      actionKey,
      beforeObservationId: beforeObsId,
      afterObservationId: afterObsId,
      startedAt: new Date().toISOString(),
      durationMs,
      result,
      error,
      uxObservations: [],
      agentThought: action.agentThought,
      screenDescription: action.screenDescription,
    };

    this.transitions.push(transition);
    this.registry.recordTransition(transition);
    this.runContext.saveTransition(transition);
  }

  private generatePostExplorationArtifacts(): void {
    try {
      const specsDir = path.join(this.runContext.runDir, "screen-specs");
      mkdirSync(specsDir, { recursive: true });

      const allElements: UIElement[] = [];
      const allPages = this.registry.getAllPages();

      for (const page of allPages) {
        const elements = this.pageElementsMap.get(page.pageId) ?? [];
        allElements.push(...elements);
        const spec = generateScreenSpec(page, elements, this.lastViewport);
        writeFileSync(
          path.join(specsDir, `${page.pageId}.json`),
          `${JSON.stringify(spec, null, 2)}\n`,
          "utf8",
        );
      }

      const tokens = extractDesignTokens(allElements);
      writeFileSync(
        path.join(this.runContext.runDir, "design-tokens.json"),
        `${JSON.stringify(tokens, null, 2)}\n`,
        "utf8",
      );

      const auditReports = allPages.map((page) =>
        auditPageUx(page.pageId, this.pageElementsMap.get(page.pageId) ?? []),
      );
      writeFileSync(
        path.join(this.runContext.runDir, "ux-audit.json"),
        `${JSON.stringify(auditReports, null, 2)}\n`,
        "utf8",
      );

      const galleryItems = this.transitions.map((t, idx) => {
        const beforeObs = this.observationMap.get(t.beforeObservationId);
        const relPath = beforeObs ? path.relative(this.runContext.runDir, beforeObs.screenshotPath) : "";
        return {
          step: idx + 1,
          fromPage: t.fromPageId,
          toPage: t.toPageId,
          action: t.action.kind,
          screenshotRelPath: relPath,
          durationMs: t.durationMs,
          result: t.result,
        };
      });

      const galleryHtml = generateGalleryHtml(
        `${this.config.app.bundleId} UX Exploration Gallery`,
        galleryItems,
        this.transitions,
      );
      writeFileSync(path.join(this.runContext.runDir, "gallery.html"), galleryHtml, "utf8");

      generateReplicationBlueprint({
        runDir: this.runContext.runDir,
        appName: this.config.app.bundleId,
        bundleId: this.config.app.bundleId,
        viewport: this.lastViewport,
        goal: this.goal,
        pages: allPages,
        pageElementsMap: this.pageElementsMap,
        observationMap: this.observationMap,
        transitions: this.transitions,
        designTokens: tokens,
      });

      this.logger.info(
        "Successfully generated post-exploration specs, tokens, audit, gallery.html, and replication blueprint",
        {
          runDir: this.runContext.runDir,
          screensCount: allPages.length,
          transitionsCount: this.transitions.length,
        },
      );
    } catch (error) {
      this.logger.warn("Failed to generate some post-exploration artifacts", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
