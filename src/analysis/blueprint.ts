import { writeFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import type { ElementBounds, PageState, Transition, UIElement, Viewport } from "../types/contracts.js";
import type { DesignTokens } from "./types.js";

export interface BlueprintStep {
  stepNumber: number;
  fromPageId: string;
  toPageId: string;
  actionKind: string;
  targetLabel: string;
  targetBounds?: ElementBounds | undefined;
  agentThought?: string | undefined;
  screenDescription?: string | undefined;
  reason: string;
  expectedEffect: string;
  beforeScreenshot?: string | undefined;
  afterScreenshot?: string | undefined;
  elementsOnScreen: Array<{
    type: string;
    label: string;
    bounds: ElementBounds;
    isInteractive: boolean;
  }>;
}

export interface BlueprintPage {
  pageId: string;
  title: string;
  screenshot?: string | undefined;
  copywriting: string[];
  components: Array<{
    type: string;
    label: string;
    bounds: ElementBounds;
    possibleActions: string[];
  }>;
}

export interface AppBlueprint {
  schemaVersion: 1;
  appName: string;
  bundleId: string;
  platform: "iOS";
  viewport: Viewport;
  goal: string;
  generatedAt: string;
  summary: {
    totalSteps: number;
    totalPages: number;
  };
  designTokens?: DesignTokens | undefined;
  steps: BlueprintStep[];
  pages: BlueprintPage[];
}

export interface BlueprintGeneratorInput {
  runDir: string;
  appName: string;
  bundleId: string;
  viewport: Viewport;
  goal?: string | undefined;
  pages: PageState[];
  pageElementsMap: Map<string, UIElement[]>;
  observationMap: Map<string, { screenshotPath: string }>;
  transitions: Transition[];
  designTokens?: DesignTokens | undefined;
}

export function generateReplicationBlueprint(input: BlueprintGeneratorInput): AppBlueprint {
  const blueprintDir = path.join(input.runDir, "blueprint");
  mkdirSync(blueprintDir, { recursive: true });

  const goal = input.goal ?? "Explore and reverse-engineer the complete UI/UX flow for app replication.";

  // Build steps
  const steps: BlueprintStep[] = input.transitions.map((trans, idx) => {
    const fromElements = input.pageElementsMap.get(trans.fromPageId) ?? [];
    const targetEl = fromElements.find(
      (el) =>
        el.elementId === trans.action.targetElementId ||
        el.semanticId === trans.action.targetSemanticId ||
        (trans.action.targetElementId && el.label?.includes(trans.action.targetElementId)),
    );

    const beforeObs = input.observationMap.get(trans.beforeObservationId);
    const afterObs = trans.afterObservationId
      ? input.observationMap.get(trans.afterObservationId)
      : undefined;

    const beforeShotRel = beforeObs
      ? path.relative(blueprintDir, beforeObs.screenshotPath).replace(/\\/g, "/")
      : undefined;
    const afterShotRel = afterObs
      ? path.relative(blueprintDir, afterObs.screenshotPath).replace(/\\/g, "/")
      : undefined;

    const elementsOnScreen = fromElements
      .filter((el) => el.bounds.width > 0 && el.bounds.height > 0)
      .slice(0, 40)
      .map((el) => ({
        type: el.type.replace(/^XCUIElementType/, ""),
        label: el.label || el.name || el.value || "",
        bounds: el.bounds,
        isInteractive: el.possibleActions.length > 0,
      }));

    return {
      stepNumber: idx + 1,
      fromPageId: trans.fromPageId,
      toPageId: trans.toPageId,
      actionKind: trans.action.kind,
      targetLabel: targetEl
        ? targetEl.label || targetEl.name || targetEl.type
        : (trans.action.targetElementId ?? ""),
      targetBounds: targetEl?.bounds,
      agentThought: trans.agentThought ?? trans.action.agentThought,
      screenDescription: trans.screenDescription ?? trans.action.screenDescription,
      reason: trans.action.reason,
      expectedEffect: trans.action.expectedEffect,
      beforeScreenshot: beforeShotRel,
      afterScreenshot: afterShotRel,
      elementsOnScreen,
    };
  });

  // Build pages
  const pages: BlueprintPage[] = input.pages.map((p) => {
    const elements = input.pageElementsMap.get(p.pageId) ?? [];
    const obs = input.observationMap.get(p.observationId);
    const shotRel = obs ? path.relative(blueprintDir, obs.screenshotPath).replace(/\\/g, "/") : undefined;

    const texts = Array.from(
      new Set(
        elements
          .map((el) => el.label || el.name || el.value || "")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
    );

    const components = elements
      .filter((el) => el.possibleActions.length > 0)
      .map((el) => ({
        type: el.type.replace(/^XCUIElementType/, ""),
        label: el.label || el.name || el.value || "",
        bounds: el.bounds,
        possibleActions: el.possibleActions,
      }));

    const titleEl = elements.find(
      (el) =>
        el.type === "XCUIElementTypeNavigationBar" ||
        (el.bounds.y < 120 && (el.label.length > 0 || el.name.length > 0)),
    );
    const title = titleEl ? titleEl.label || titleEl.name || p.pageId : p.pageId;

    return {
      pageId: p.pageId,
      title,
      screenshot: shotRel,
      copywriting: texts,
      components,
    };
  });

  const blueprint: AppBlueprint = {
    schemaVersion: 1,
    appName: input.appName,
    bundleId: input.bundleId,
    platform: "iOS",
    viewport: input.viewport,
    goal,
    generatedAt: new Date().toISOString(),
    summary: {
      totalSteps: steps.length,
      totalPages: pages.length,
    },
    designTokens: input.designTokens,
    steps,
    pages,
  };

  // Write JSON blueprint
  const jsonPath = path.join(blueprintDir, "app-blueprint.json");
  writeFileSync(jsonPath, JSON.stringify(blueprint, null, 2), "utf8");

  // Write Markdown AI Replication Prompt
  const mdPath = path.join(blueprintDir, "REPLICATION_GUIDE.md");
  const markdown = renderReplicationGuideMarkdown(blueprint);
  writeFileSync(mdPath, markdown, "utf8");

  return blueprint;
}

export function renderReplicationGuideMarkdown(blueprint: AppBlueprint): string {
  const lines: string[] = [];

  lines.push(`# App Replication & Reverse-Engineering Dossier`);
  lines.push(
    `> Automatically generated by UXRecon for LLM code generation (SwiftUI / Flutter / React Native).\n`,
  );

  lines.push(`## 1. System Prompt for App Replicator Agent`);
  lines.push("```text");
  lines.push("You are an expert mobile frontend software architect and UI engineer.");
  lines.push(
    "Your goal is to accurately recreate and clone the iOS mobile application flow specified below.",
  );
  lines.push(
    "Implement production-grade UI components, state navigation, responsive layout, and interactive states matching the exact specifications, tokens, and step-by-step user interactions.",
  );
  lines.push("```\n");

  lines.push(`## 2. Target Application Overview`);
  lines.push(`- **App Name**: \`${blueprint.appName}\``);
  lines.push(`- **Bundle Identifier**: \`${blueprint.bundleId}\``);
  lines.push(
    `- **Platform / Viewport**: iOS (${blueprint.viewport.width} × ${blueprint.viewport.height} pt)`,
  );
  lines.push(`- **Exploration Goal**: ${blueprint.goal}`);
  lines.push(
    `- **Captured Flow Scope**: ${blueprint.summary.totalSteps} interaction steps across ${blueprint.summary.totalPages} unique screens\n`,
  );

  if (blueprint.designTokens) {
    lines.push(`## 3. Extracted Design Tokens & Component Rules`);
    lines.push(`- **Spacing Scale (pt)**: ${blueprint.designTokens.spacingScale.join(", ")}`);
    lines.push(`- **Inferred Corner Radii (pt)**: ${blueprint.designTokens.inferredRadii.join(", ")}`);
    lines.push(`- **Standard Touch Target**: Apple HIG min 44 × 44 pt\n`);
  }

  lines.push(`## 4. Step-by-Step Interactive Flow Walkthrough`);
  lines.push(`Follow each step sequentially to reconstruct the navigation logic and user journey:\n`);

  blueprint.steps.forEach((step) => {
    lines.push(`### Step ${step.stepNumber}: [${step.fromPageId}] ➔ [${step.toPageId}]`);
    if (step.beforeScreenshot) {
      lines.push(`![Screen Before Step ${step.stepNumber}](${step.beforeScreenshot})\n`);
    }

    if (step.screenDescription) {
      lines.push(`**Screen Context**: ${step.screenDescription}\n`);
    }
    if (step.agentThought) {
      lines.push(`**AI Agent Thought**: _${step.agentThought}_\n`);
    }

    lines.push(`- **Action Executed**: \`${step.actionKind.toUpperCase()}\``);
    lines.push(`- **Target Component**: **${step.targetLabel || "(screen level)"}**`);
    if (step.targetBounds) {
      lines.push(
        `- **Element Frame**: x=${step.targetBounds.x}, y=${step.targetBounds.y}, w=${step.targetBounds.width}, h=${step.targetBounds.height} pt`,
      );
    }
    lines.push(`- **Intent / Reason**: ${step.reason}`);
    lines.push(`- **Expected Transition**: ${step.expectedEffect}\n`);

    if (step.elementsOnScreen.length > 0) {
      lines.push(`<details><summary>Visible Screen Elements (${step.elementsOnScreen.length})</summary>\n`);
      lines.push(`| Type | Label / Text | Bounds (x,y,w,h) | Interactive |`);
      lines.push(`| :--- | :--- | :--- | :---: |`);
      step.elementsOnScreen.forEach((el) => {
        const b = `${el.bounds.x},${el.bounds.y},${el.bounds.width}x${el.bounds.height}`;
        const cleanLabel = el.label.replace(/\|/g, "\\|").replace(/\n/g, " ");
        lines.push(`| ${el.type} | ${cleanLabel || "-"} | ${b} | ${el.isInteractive ? "✅" : "❌"} |`);
      });
      lines.push(`\n</details>\n`);
    }
  });

  lines.push(`## 5. Screen Inventory & Copywriting Dictionary`);
  blueprint.pages.forEach((page) => {
    lines.push(`### Screen: \`${page.title}\` (ID: ${page.pageId})`);
    if (page.screenshot) {
      lines.push(`![Screenshot](${page.screenshot})\n`);
    }

    lines.push(`#### Copywriting Strings:`);
    page.copywriting.forEach((txt) => {
      lines.push(`- "${txt.replace(/"/g, '\\"')}"`);
    });

    lines.push(`\n#### Interactive Controls:`);
    page.components.forEach((comp) => {
      lines.push(
        `- **[${comp.type}]** "${comp.label || "Unnamed"}" — bounds: (${comp.bounds.x}, ${comp.bounds.y}, ${comp.bounds.width}×${comp.bounds.height}) [actions: ${comp.possibleActions.join(", ")}]`,
      );
    });
    lines.push("");
  });

  return lines.join("\n");
}
