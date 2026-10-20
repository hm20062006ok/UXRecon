import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { remote, type Browser } from "webdriverio";
import {
  appiumConnection,
  capabilities,
  createArtifactDir,
  optional,
  redacted,
  writeJson,
} from "./common.js";

/**
 * P0-T3 probe: observe -> tap one reversible control -> observe -> restore -> observe.
 *
 * Two lessons are baked into this version:
 * 1. `driver.back()` is not implemented by the XCUITest driver for iOS; it returns
 *    success without navigating. Restoration therefore always uses an explicit
 *    in-app target and falls back to an app relaunch.
 * 2. Parent-page restoration is verified by comparing on-screen element
 *    fingerprints, never by trusting the restore command's return value.
 */

const SETTLE_MS = 900;
const RESTORE_SIMILARITY = 0.95;
const CHANGE_SIMILARITY = 0.98;
const CALIBRATION_SAMPLES = 3;
const CALIBRATION_GAP_MS = 2500;

type Viewport = { width: number; height: number };

type ActiveAppInfo = { bundleId?: string; name?: string; pid?: number };

type ElementRecord = {
  type: string;
  name: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  selected: boolean;
};

type Observation = {
  name: string;
  capturedAt: string;
  screenshot: string;
  source: string;
  xml: string;
  fingerprint: string;
  elementCount: number;
  onScreenKeys: string[];
};

type RecoveryStep = {
  level: "in-app-back" | "app-relaunch";
  attempts: number;
  similarity: number;
  succeeded: boolean;
};

type IterationRecord = {
  index: number;
  startedAt: string;
  durationMs: number;
  target: { locator: string; resolvedType: string | null; resolvedRect: string | null };
  before: { fingerprint: string; screenshot: string; source: string };
  after: { fingerprint: string; screenshot: string; source: string; similarityToBefore: number };
  restored: { fingerprint: string; screenshot: string; source: string; similarityToBefore: number };
  changed: boolean;
  restoredOk: boolean;
  recovery: RecoveryStep[];
  status: "passed" | "failed";
  error?: string;
};

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

const ATTRIBUTE_PATTERN = /([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g;

function parseElements(xml: string): ElementRecord[] {
  const elements: ElementRecord[] = [];
  for (const match of xml.matchAll(/<XCUIElementType([A-Za-z]+)\b([^>]*)>/g)) {
    const type = match[1];
    const raw = match[2];
    if (!type || !raw) continue;
    const attributes: Record<string, string> = {};
    for (const attribute of raw.matchAll(ATTRIBUTE_PATTERN)) {
      const key = attribute[1];
      const value = attribute[2];
      if (key !== undefined && value !== undefined) attributes[key] = decodeXml(value);
    }
    elements.push({
      type: `XCUIElementType${type}`,
      name: attributes["name"] ?? "",
      label: attributes["label"] ?? "",
      x: Number(attributes["x"] ?? "0"),
      y: Number(attributes["y"] ?? "0"),
      width: Number(attributes["width"] ?? "0"),
      height: Number(attributes["height"] ?? "0"),
      visible: attributes["visible"] === "true",
      selected: (attributes["traits"] ?? "").includes("Selected"),
    });
  }
  return elements;
}

function elementKey(element: ElementRecord): string {
  return [
    element.type,
    element.name,
    element.label,
    element.x,
    element.y,
    element.width,
    element.height,
    element.selected ? "sel" : "unsel",
  ].join("|");
}

/** WDA reports `visible="true"` for offscreen carousel pages, so geometry is filtered too. */
function isOnScreen(element: ElementRecord, viewport: Viewport): boolean {
  return (
    element.visible &&
    element.width > 0 &&
    element.height > 0 &&
    element.x >= -1 &&
    element.y >= -1 &&
    element.x < viewport.width &&
    element.y < viewport.height
  );
}

/**
 * Anonymous layout containers (`XCUIElementTypeOther` with no name/label) shift
 * by tens of points between visually identical states — e.g. after a tab round
 * trip — and would otherwise make a correct restore look like a mismatch.
 * Only elements that carry semantics, or that are real controls, take part in
 * fingerprint comparison.
 */
const CONTROL_TYPES = new Set([
  "XCUIElementTypeButton",
  "XCUIElementTypeCell",
  "XCUIElementTypeStaticText",
  "XCUIElementTypeTextField",
  "XCUIElementTypeSecureTextField",
  "XCUIElementTypeSwitch",
  "XCUIElementTypeSlider",
  "XCUIElementTypeSegmentedControl",
  "XCUIElementTypeLink",
  "XCUIElementTypeImage",
  "XCUIElementTypeTabBar",
  "XCUIElementTypePickerWheel",
]);

function isFingerprintRelevant(element: ElementRecord, viewport: Viewport): boolean {
  if (!isOnScreen(element, viewport)) return false;
  return element.name.length > 0 || element.label.length > 0 || CONTROL_TYPES.has(element.type);
}

function fingerprintOf(keys: string[]): string {
  const sorted = [...keys].sort();
  return createHash("sha256").update(sorted.join("\n")).digest("hex").slice(0, 16);
}

function similarity(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const key of a) if (b.has(key)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function escapePredicate(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function buttonPredicate(name: string): string {
  return `-ios predicate string:type == "XCUIElementTypeButton" AND name == "${escapePredicate(name)}"`;
}

async function observe(
  client: Browser,
  directory: string,
  name: string,
  volatileKeys: Set<string>,
  viewport: Viewport,
): Promise<Observation> {
  const capturedAt = new Date().toISOString();
  const screenshot = path.join(directory, `${name}.png`);
  const source = path.join(directory, `${name}.xml`);
  await client.saveScreenshot(screenshot);
  const xml = await client.getPageSource();
  await writeFile(source, xml, "utf8");
  const elements = parseElements(xml);
  const onScreenKeys = elements
    .filter((element) => isFingerprintRelevant(element, viewport))
    .map(elementKey)
    .filter((key) => !volatileKeys.has(key));
  return {
    name,
    capturedAt,
    screenshot,
    source,
    xml,
    fingerprint: fingerprintOf(onScreenKeys),
    elementCount: elements.length,
    onScreenKeys,
  };
}

/**
 * Elements that change between two observations of the same untouched page
 * (carousel rotation, animations) must not participate in restore verification.
 */
async function calibrateVolatileKeys(
  client: Browser,
  directory: string,
  viewport: Viewport,
): Promise<{ volatile: Set<string>; samples: string[] }> {
  const samples: string[][] = [];
  for (let index = 0; index < CALIBRATION_SAMPLES; index += 1) {
    const observation = await observe(client, directory, `000-calibration-${index}`, new Set(), viewport);
    samples.push(observation.onScreenKeys);
    if (index < CALIBRATION_SAMPLES - 1) await client.pause(CALIBRATION_GAP_MS);
  }
  const volatile = new Set<string>();
  const [first, ...rest] = samples;
  if (!first) return { volatile, samples: [] };
  const baseline = new Set(first);
  for (const sample of rest) {
    const current = new Set(sample);
    for (const key of baseline) if (!current.has(key)) volatile.add(key);
    for (const key of current) if (!baseline.has(key)) volatile.add(key);
  }
  // Anything that only appeared in one of the later samples is volatile as well.
  for (let left = 1; left < samples.length; left += 1) {
    for (let right = left + 1; right < samples.length; right += 1) {
      const a = new Set(samples[left] ?? []);
      const b = new Set(samples[right] ?? []);
      for (const key of a) if (!b.has(key)) volatile.add(key);
      for (const key of b) if (!a.has(key)) volatile.add(key);
    }
  }
  return { volatile, samples: samples.map((sample) => fingerprintOf(sample)) };
}

async function resolveTarget(client: Browser, accessibilityId: string) {
  const byPredicate = await client.$(buttonPredicate(accessibilityId));
  if (await byPredicate.isExisting()) {
    return { element: byPredicate, locator: buttonPredicate(accessibilityId), type: "XCUIElementTypeButton" };
  }
  const byAccessibilityId = await client.$(`~${accessibilityId}`);
  if (await byAccessibilityId.isExisting()) {
    const tagName = await byAccessibilityId.getTagName();
    return { element: byAccessibilityId, locator: `~${accessibilityId}`, type: tagName };
  }
  return null;
}

async function restartApp(client: Browser, bundleId: string): Promise<void> {
  await client.execute("mobile: terminateApp", { bundleId }).catch(() => undefined);
  await client.pause(500);
  await client.execute("mobile: launchApp", { bundleId });
  await client.pause(2500);
}

async function main(): Promise<void> {
  const output = await createArtifactDir("p0-real-device");
  const caps = capabilities();
  const bundleId = String(caps["appium:bundleId"]);
  const startedAt = new Date().toISOString();
  const targetId = optional("UXR_SAFE_TAP_ACCESSIBILITY_ID", "Market");
  const restoreId = optional("UXR_SAFE_TAP_RESTORE_ACCESSIBILITY_ID", "Assets");
  const iterations = Number(optional("UXR_SAFE_TAP_ITERATIONS", "1"));
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 10) {
    throw new Error("UXR_SAFE_TAP_ITERATIONS must be an integer from 1 to 10");
  }

  let client: Browser | undefined;
  const iterationRecords: IterationRecord[] = [];

  try {
    client = await remote({ ...appiumConnection(), capabilities: caps });
    const viewport = await client.getWindowSize();

    // Start from a known page instead of inheriting whatever the previous run left behind.
    await restartApp(client, bundleId);
    const activeApp = (await client.execute("mobile: activeAppInfo", {})) as ActiveAppInfo;

    const calibration = await calibrateVolatileKeys(client, output, viewport);
    const volatile = calibration.volatile;

    const initial = await observe(client, output, "000-initial", volatile, viewport);
    const systemAlert = parseElements(initial.xml).some((element) => element.type === "XCUIElementTypeAlert");

    const targetProbe = await resolveTarget(client, targetId);
    const restoreProbe = await resolveTarget(client, restoreId);
    if (!targetProbe || !restoreProbe) {
      throw new Error(
        `Safe-tap path unavailable on the current page (target="${targetId}", restore="${restoreId}"). ` +
          "Refusing to guess a location. Inspect 000-initial.png and 000-initial.xml.",
      );
    }
    if (systemAlert) {
      throw new Error("A system alert is covering the app; it requires manual handling before tapping.");
    }

    const targetType = await targetProbe.element.getTagName();
    const targetLocation = await targetProbe.element.getLocation();
    const targetSize = await targetProbe.element.getSize();
    const resolvedRect = `x=${targetLocation.x} y=${targetLocation.y} w=${targetSize.width} h=${targetSize.height}`;

    for (let index = 1; index <= iterations; index += 1) {
      const tag = `it-${String(index).padStart(2, "0")}`;
      const iterationStartedAt = Date.now();
      const record: IterationRecord = {
        index,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        target: { locator: targetProbe.locator, resolvedType: targetType, resolvedRect },
        before: { fingerprint: "", screenshot: "", source: "" },
        after: { fingerprint: "", screenshot: "", source: "", similarityToBefore: 0 },
        restored: { fingerprint: "", screenshot: "", source: "", similarityToBefore: 0 },
        changed: false,
        restoredOk: false,
        recovery: [],
        status: "failed",
      };

      try {
        const before = await observe(client, output, `${tag}-before`, volatile, viewport);
        record.before = {
          fingerprint: before.fingerprint,
          screenshot: before.screenshot,
          source: before.source,
        };

        const element = await resolveTarget(client, targetId);
        if (!element) throw new Error(`Target disappeared before tap: ${targetId}`);
        if (!(await element.element.isDisplayed())) throw new Error(`Target not displayed: ${targetId}`);
        await element.element.click();
        await client.pause(SETTLE_MS);

        const after = await observe(client, output, `${tag}-after`, volatile, viewport);
        const afterSimilarity = similarity(after.onScreenKeys, before.onScreenKeys);
        record.after = {
          fingerprint: after.fingerprint,
          screenshot: after.screenshot,
          source: after.source,
          similarityToBefore: Number(afterSimilarity.toFixed(4)),
        };
        record.changed = afterSimilarity < CHANGE_SIMILARITY;

        // Restore ladder: explicit in-app control (2 attempts), then app relaunch.
        let restored: Observation | undefined;
        let bestScore = 0;
        for (let attempt = 1; attempt <= 2 && !restored; attempt += 1) {
          const restoreElement = await resolveTarget(client, restoreId);
          if (!restoreElement) continue;
          if (!(await restoreElement.element.isDisplayed())) continue;
          await restoreElement.element.click();
          await client.pause(SETTLE_MS);
          const candidate = await observe(client, output, `${tag}-restore-a${attempt}`, volatile, viewport);
          bestScore = similarity(candidate.onScreenKeys, before.onScreenKeys);
          if (bestScore >= RESTORE_SIMILARITY) {
            restored = candidate;
            record.recovery.push({
              level: "in-app-back",
              attempts: attempt,
              similarity: Number(bestScore.toFixed(4)),
              succeeded: true,
            });
          }
        }
        if (!restored) {
          record.recovery.push({
            level: "in-app-back",
            attempts: 2,
            similarity: Number(bestScore.toFixed(4)),
            succeeded: false,
          });
          await restartApp(client, bundleId);
          const relaunched = await observe(client, output, `${tag}-restore-relaunch`, volatile, viewport);
          const relaunchScore = similarity(relaunched.onScreenKeys, before.onScreenKeys);
          record.recovery.push({
            level: "app-relaunch",
            attempts: 1,
            similarity: Number(relaunchScore.toFixed(4)),
            succeeded: relaunchScore >= RESTORE_SIMILARITY,
          });
          if (relaunchScore >= RESTORE_SIMILARITY) restored = relaunched;
        }

        if (restored) {
          record.restored = {
            fingerprint: restored.fingerprint,
            screenshot: restored.screenshot,
            source: restored.source,
            similarityToBefore: similarity(restored.onScreenKeys, before.onScreenKeys),
          };
          record.restoredOk = true;
        }

        if (!record.changed) throw new Error("Tap produced no observable state change");
        if (!record.restoredOk) throw new Error("Parent page was not restored by any recovery level");
        record.status = "passed";
      } catch (error) {
        record.error = error instanceof Error ? error.message : String(error);
        record.status = "failed";
      }

      record.durationMs = Date.now() - iterationStartedAt;
      iterationRecords.push(record);
      console.log(
        `[${record.status.toUpperCase()}] iteration ${index}/${iterations} ` +
          `changed=${record.changed} restored=${record.restoredOk} ${record.durationMs}ms` +
          (record.error ? ` error=${record.error}` : ""),
      );

      if (record.status === "failed") {
        // A blocked page must stop the run; guessing taps to recover is forbidden.
        break;
      }
    }

    const succeeded = iterationRecords.filter((record) => record.status === "passed").length;
    const required = Math.ceil(iterations * 0.9);
    const passed = succeeded >= required;
    const artifacts = [
      initial.screenshot,
      initial.source,
      ...iterationRecords.flatMap((record) => [
        record.before.screenshot,
        record.before.source,
        record.after.screenshot,
        record.after.source,
        record.restored.screenshot,
        record.restored.source,
      ]),
    ].filter((entry) => entry.length > 0);

    await writeJson(path.join(output, "result.json"), {
      schemaVersion: 2,
      status: passed ? "passed" : "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      deviceUdid: redacted(String(caps["appium:udid"])),
      requestedBundleId: bundleId,
      activeApp: { bundleId: activeApp.bundleId, name: activeApp.name, pid: activeApp.pid },
      viewport,
      orientation: await client.getOrientation(),
      calibration: { samples: calibration.samples, volatileKeyCount: volatile.size },
      initial: {
        fingerprint: initial.fingerprint,
        elementCount: initial.elementCount,
        screenshot: initial.screenshot,
        source: initial.source,
      },
      safeTap: {
        targetAccessibilityId: targetId,
        restoreAccessibilityId: restoreId,
        targetLocator: targetProbe.locator,
        targetResolvedType: targetType,
        targetResolvedRect: resolvedRect,
        iterations,
        succeeded,
        required,
        restoreSimilarityThreshold: RESTORE_SIMILARITY,
        changeSimilarityThreshold: CHANGE_SIMILARITY,
      },
      iterations: iterationRecords,
      artifacts,
      limitations: [
        "Restoration is verified by on-screen element fingerprint similarity, not by screenshot pixel comparison.",
        "Elements that change on an untouched page are excluded via a 3-sample calibration pass.",
        "The XCUITest driver does not implement driver.back() for iOS; restoration uses in-app controls plus an app relaunch fallback.",
      ],
    });

    console.log(
      `P0 real-device probe ${passed ? "passed" : "failed"} (${succeeded}/${iterations}). Artifacts: ${output}`,
    );
    if (!passed) process.exitCode = 1;
  } catch (error) {
    await writeJson(path.join(output, "result.json"), {
      schemaVersion: 2,
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      targetAccessibilityId: targetId,
      restoreAccessibilityId: restoreId,
      iterations: iterationRecords,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await client?.deleteSession().catch(() => undefined);
  }
}

await main();
