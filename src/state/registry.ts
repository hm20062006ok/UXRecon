import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Observation, PageFingerprints, PageState, Transition, UIElement } from "../types/contracts.js";
import { generateActionKey } from "./action-key.js";
import { computePageFingerprints } from "./fingerprint.js";

export interface NavigationGraph {
  schemaVersion: 1;
  updatedAt: string;
  pages: Record<string, PageState>;
  transitions: Transition[];
  adjacency: Record<string, string[]>;
}

export interface StateCheckpoint {
  schemaVersion: 1;
  savedAt: string;
  pageCount: number;
  transitionCount: number;
  pages: PageState[];
  transitions: Transition[];
}

/**
 * Registry and navigation graph coordinator for discovered application states.
 * Manages fingerprint indexing, state identity matching, transition graphs,
 * and atomic snapshot persistence.
 */
export class StateRegistry {
  private readonly pages = new Map<string, PageState>();
  private readonly transitions: Transition[] = [];

  private readonly exactIndex = new Map<string, string>();
  private readonly structuralIndex = new Map<string, string>();

  /**
   * Registers a page observation:
   * - Computes exact & structural fingerprints
   * - Checks whether the page has already been discovered
   * - Returns existing PageState or registers a newly discovered PageState
   */
  registerObservation(obs: Observation, elements: UIElement[], interactive: UIElement[]): PageState {
    const fingerprints = computePageFingerprints(elements, {
      viewport: obs.viewport,
      keyboardVisible: obs.keyboardVisible,
      systemAlert: obs.systemAlert,
    });

    // 1. Check exact match
    let existingPageId = this.exactIndex.get(fingerprints.exact);

    // 2. Check structural match
    if (!existingPageId) {
      existingPageId = this.structuralIndex.get(fingerprints.structural);
    }

    if (existingPageId) {
      const existing = this.pages.get(existingPageId)!;
      existing.lastVisitedAt = obs.capturedAt;
      existing.observationId = obs.observationId;
      existing.interactiveElements = interactive;

      // Update exact index in case this was a structural match on slightly updated content
      this.exactIndex.set(fingerprints.exact, existing.pageId);
      return existing;
    }

    // 3. New page discovered
    const pageNumber = this.pages.size + 1;
    const pageId = `page_${pageNumber}_${fingerprints.structural.slice(0, 8)}`;

    const pendingActionKeys: string[] = [];
    for (const elem of interactive) {
      for (const action of elem.possibleActions) {
        const key = generateActionKey({
          pageFingerprint: fingerprints.structural,
          actionKind: action,
          targetSemanticId: elem.semanticId,
        });
        if (!pendingActionKeys.includes(key)) {
          pendingActionKeys.push(key);
        }
      }
    }

    const newPage: PageState = {
      pageId,
      fingerprints,
      observationId: obs.observationId,
      interactiveElements: interactive,
      visitedActionKeys: [],
      pendingActionKeys,
      status: "new",
      firstSeenAt: obs.capturedAt,
      lastVisitedAt: obs.capturedAt,
    };

    this.pages.set(pageId, newPage);
    this.exactIndex.set(fingerprints.exact, pageId);
    this.structuralIndex.set(fingerprints.structural, pageId);

    return newPage;
  }

  /**
   * Records an executed transition between pages and updates pending/visited actions.
   */
  recordTransition(transition: Transition): void {
    this.transitions.push(transition);

    const fromPage = this.pages.get(transition.fromPageId);
    if (fromPage) {
      // Move actionKey from pending to visited
      const pendingIdx = fromPage.pendingActionKeys.indexOf(transition.actionKey);
      if (pendingIdx !== -1) {
        fromPage.pendingActionKeys.splice(pendingIdx, 1);
      }
      if (!fromPage.visitedActionKeys.includes(transition.actionKey)) {
        fromPage.visitedActionKeys.push(transition.actionKey);
      }

      // Update state status
      if (fromPage.pendingActionKeys.length === 0) {
        fromPage.status = "complete";
      } else if (fromPage.status === "new") {
        fromPage.status = "exploring";
      }
    }

    const toPage = this.pages.get(transition.toPageId);
    if (toPage && toPage.pageId !== transition.fromPageId && !toPage.parentTransitionId) {
      toPage.parentTransitionId = transition.transitionId;
    }
  }

  markActionVisited(pageId: string, actionKey: string): void {
    const page = this.pages.get(pageId);
    if (!page) return;

    const pendingIdx = page.pendingActionKeys.indexOf(actionKey);
    if (pendingIdx !== -1) {
      page.pendingActionKeys.splice(pendingIdx, 1);
    }
    if (!page.visitedActionKeys.includes(actionKey)) {
      page.visitedActionKeys.push(actionKey);
    }
  }

  getPage(pageId: string): PageState | undefined {
    return this.pages.get(pageId);
  }

  getAllPages(): PageState[] {
    return Array.from(this.pages.values());
  }

  getTransitions(): Transition[] {
    return [...this.transitions];
  }

  getOutgoingTransitions(pageId: string): Transition[] {
    return this.transitions.filter((t) => t.fromPageId === pageId);
  }

  getIncomingTransitions(pageId: string): Transition[] {
    return this.transitions.filter((t) => t.toPageId === pageId);
  }

  /**
   * Computes an adjacency list representation of the navigation graph
   * (fromPageId -> list of reachable toPageIds).
   */
  getAdjacencyList(): Record<string, string[]> {
    const adjacency: Record<string, string[]> = {};
    for (const pageId of this.pages.keys()) {
      adjacency[pageId] = [];
    }

    for (const transition of this.transitions) {
      if (transition.result === "changed" || transition.result === "no_change") {
        const targets = adjacency[transition.fromPageId] ?? [];
        if (!targets.includes(transition.toPageId)) {
          targets.push(transition.toPageId);
        }
        adjacency[transition.fromPageId] = targets;
      }
    }

    return adjacency;
  }

  getNavigationGraph(): NavigationGraph {
    const pagesObj: Record<string, PageState> = {};
    for (const [id, state] of this.pages.entries()) {
      pagesObj[id] = state;
    }

    return {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      pages: pagesObj,
      transitions: this.getTransitions(),
      adjacency: this.getAdjacencyList(),
    };
  }

  /**
   * Atomically persists checkpoint.json and navigation-graph.json to disk.
   */
  async save(directoryPath: string): Promise<void> {
    await mkdir(directoryPath, { recursive: true });

    const checkpoint: StateCheckpoint = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      pageCount: this.pages.size,
      transitionCount: this.transitions.length,
      pages: this.getAllPages(),
      transitions: this.getTransitions(),
    };

    const graph = this.getNavigationGraph();

    const timestamp = Date.now();
    const cpPath = path.join(directoryPath, "checkpoint.json");
    const cpTmp = path.join(directoryPath, `checkpoint.json.tmp.${timestamp}`);

    const graphPath = path.join(directoryPath, "navigation-graph.json");
    const graphTmp = path.join(directoryPath, `navigation-graph.json.tmp.${timestamp}`);

    // Atomic write checkpoint
    await writeFile(cpTmp, JSON.stringify(checkpoint, null, 2), "utf8");
    await rename(cpTmp, cpPath);

    // Atomic write navigation graph
    await writeFile(graphTmp, JSON.stringify(graph, null, 2), "utf8");
    await rename(graphTmp, graphPath);
  }

  /**
   * Restores registry state from a persisted checkpoint directory.
   */
  async load(directoryPath: string): Promise<void> {
    const cpPath = path.join(directoryPath, "checkpoint.json");
    const content = await readFile(cpPath, "utf8");
    const checkpoint = JSON.parse(content) as StateCheckpoint;

    this.pages.clear();
    this.transitions.length = 0;
    this.exactIndex.clear();
    this.structuralIndex.clear();

    for (const page of checkpoint.pages) {
      this.pages.set(page.pageId, page);
      this.exactIndex.set(page.fingerprints.exact, page.pageId);
      this.structuralIndex.set(page.fingerprints.structural, page.pageId);
    }

    for (const transition of checkpoint.transitions) {
      this.transitions.push(transition);
    }
  }

  /**
   * Finds a registered page by fingerprint.
   */
  findPageByFingerprint(fingerprints: Partial<PageFingerprints>): PageState | undefined {
    if (fingerprints.exact) {
      const pageId = this.exactIndex.get(fingerprints.exact);
      if (pageId) return this.pages.get(pageId);
    }
    if (fingerprints.structural) {
      const pageId = this.structuralIndex.get(fingerprints.structural);
      if (pageId) return this.pages.get(pageId);
    }
    return undefined;
  }
}
