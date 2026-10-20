import type { ActionKind, ElementBounds, LocatorCandidate, UIElement } from "../types/contracts.js";
import { computeSemanticId } from "../state/semantic-id.js";

export interface RawXmlNode {
  type: string;
  attributes: Record<string, string>;
  children: RawXmlNode[];
  parent?: RawXmlNode | undefined;
  tagSiblingIndex: number;
  xpath: string;
  classChainPath: string;
}

export interface ParseResult {
  elements: UIElement[];
  tree: RawXmlNode;
  keyboardVisible: boolean;
  systemAlert: boolean;
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function escapePredicate(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapeXPath(value: string): string {
  return value.replaceAll('"', "&quot;");
}

const ATTRIBUTE_REGEX = /([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g;

function parseAttributes(rawAttrs: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of rawAttrs.matchAll(ATTRIBUTE_REGEX)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      attributes[key] = decodeXmlEntities(value);
    }
  }
  return attributes;
}

/**
 * Infer supported action kinds based on iOS element type, traits, and editable state.
 */
export function inferPossibleActions(type: string, attributes: Record<string, string>): ActionKind[] {
  const actions: ActionKind[] = [];
  const traits = attributes["traits"] ?? "";
  const isEnabled = attributes["enabled"] !== "false";

  if (!isEnabled) {
    return actions;
  }

  // Text inputs
  switch (type) {
    case "XCUIElementTypeTextField":
    case "XCUIElementTypeSecureTextField":
    case "XCUIElementTypeSearchField":
    case "XCUIElementTypeTextView":
      actions.push("tap", "type", "clear");
      return actions;
  }

  // Tappable controls
  switch (type) {
    case "XCUIElementTypeButton":
    case "XCUIElementTypeLink":
    case "XCUIElementTypeCell":
    case "XCUIElementTypeSwitch":
    case "XCUIElementTypeSegmentedControl":
    case "XCUIElementTypeKey":
    case "XCUIElementTypeMenuItem":
    case "XCUIElementTypePickerWheel":
    case "XCUIElementTypeTabBar":
      actions.push("tap");
      break;
    default:
      if (traits.includes("Button") || traits.includes("Link")) {
        actions.push("tap");
      }
      break;
  }

  // Scrollable containers
  switch (type) {
    case "XCUIElementTypeScrollView":
    case "XCUIElementTypeTable":
    case "XCUIElementTypeCollectionView":
    case "XCUIElementTypeWebView":
      if (!actions.includes("scroll")) {
        actions.push("scroll");
      }
      break;
  }

  return actions;
}

/**
 * Generates 4 locator candidates (accessibility_id, predicate, class_chain, xpath)
 * with confidence ratings.
 */
export function generateLocatorCandidates(
  type: string,
  attributes: Record<string, string>,
  node: RawXmlNode,
): LocatorCandidate[] {
  const candidates: LocatorCandidate[] = [];
  const name = attributes["name"] ?? "";
  const label = attributes["label"] ?? "";
  const value = attributes["value"] ?? "";

  // 1. Accessibility ID
  if (name.length > 0) {
    candidates.push({
      strategy: "accessibility_id",
      selector: name,
      confidence: 0.95,
    });
  } else if (label.length > 0) {
    candidates.push({
      strategy: "accessibility_id",
      selector: label,
      confidence: 0.85,
    });
  }

  // 2. Predicate
  if (name.length > 0 && label.length > 0 && name !== label) {
    candidates.push({
      strategy: "predicate",
      selector: `type == "${type}" AND name == "${escapePredicate(name)}" AND label == "${escapePredicate(label)}"`,
      confidence: 0.9,
    });
  } else if (name.length > 0) {
    candidates.push({
      strategy: "predicate",
      selector: `type == "${type}" AND name == "${escapePredicate(name)}"`,
      confidence: 0.88,
    });
  } else if (label.length > 0) {
    candidates.push({
      strategy: "predicate",
      selector: `type == "${type}" AND label == "${escapePredicate(label)}"`,
      confidence: 0.82,
    });
  } else if (value.length > 0) {
    candidates.push({
      strategy: "predicate",
      selector: `type == "${type}" AND value == "${escapePredicate(value)}"`,
      confidence: 0.75,
    });
  } else {
    candidates.push({
      strategy: "predicate",
      selector: `type == "${type}" AND visible == 1`,
      confidence: 0.4,
    });
  }

  // 3. Class Chain
  if (name.length > 0) {
    candidates.push({
      strategy: "class_chain",
      selector: `**/${type}[\`name == "${escapePredicate(name)}"\`]`,
      confidence: 0.82,
    });
  } else if (label.length > 0) {
    candidates.push({
      strategy: "class_chain",
      selector: `**/${type}[\`label == "${escapePredicate(label)}"\`]`,
      confidence: 0.78,
    });
  } else {
    candidates.push({
      strategy: "class_chain",
      selector: node.classChainPath,
      confidence: 0.6,
    });
  }

  // 4. XPath
  if (name.length > 0) {
    candidates.push({
      strategy: "xpath",
      selector: `//${type}[@name="${escapeXPath(name)}"]`,
      confidence: 0.75,
    });
  } else if (label.length > 0) {
    candidates.push({
      strategy: "xpath",
      selector: `//${type}[@label="${escapeXPath(label)}"]`,
      confidence: 0.7,
    });
  } else {
    candidates.push({
      strategy: "xpath",
      selector: `//${node.xpath.replace(/^\/+/, "")}`,
      confidence: 0.55,
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Token-based tree parser for Appium/XCUITest XML pageSource.
 */
export function parseXmlTree(xml: string): RawXmlNode {
  // Strip XML prolog and comments
  const cleanXml = xml.replace(/<\?xml[^>]*\?>/gi, "").replace(/<!--[\s\S]*?-->/g, "");

  const tagPattern = /<(\/)?([A-Za-z0-9_:-]+)((?:\s+[A-Za-z_:][-A-Za-z0-9_:.]*(?:="[^"]*")?)*)\s*(\/?)>/g;

  let rootNode: RawXmlNode | undefined;
  const stack: RawXmlNode[] = [];
  const siblingCountsByParent = new Map<RawXmlNode | undefined, Map<string, number>>();

  for (const match of cleanXml.matchAll(tagPattern)) {
    const isClosing = match[1] === "/";
    const tagName = match[2];
    const rawAttrs = match[3] ?? "";
    const isSelfClosing = match[4] === "/";

    if (!tagName) continue;

    if (isClosing) {
      if (stack.length > 0 && stack[stack.length - 1]!.type === tagName) {
        stack.pop();
      }
      continue;
    }

    const parent = stack.length > 0 ? stack[stack.length - 1] : undefined;
    let counts = siblingCountsByParent.get(parent);
    if (!counts) {
      counts = new Map<string, number>();
      siblingCountsByParent.set(parent, counts);
    }
    const siblingIndex = (counts.get(tagName) ?? 0) + 1;
    counts.set(tagName, siblingIndex);

    const attributes = parseAttributes(rawAttrs);

    const xpath = parent ? `${parent.xpath}/${tagName}[${siblingIndex}]` : `/${tagName}[${siblingIndex}]`;

    const classChainPath = parent
      ? `${parent.classChainPath}/${tagName}[${siblingIndex}]`
      : `**/${tagName}[${siblingIndex}]`;

    const node: RawXmlNode = {
      type: tagName,
      attributes,
      children: [],
      parent,
      tagSiblingIndex: siblingIndex,
      xpath,
      classChainPath,
    };

    if (parent) {
      parent.children.push(node);
    } else if (!rootNode) {
      rootNode = node;
    }

    if (!isSelfClosing) {
      stack.push(node);
    }
  }

  if (!rootNode) {
    // Fallback dummy node if XML was empty
    return {
      type: "XCUIElementTypeApplication",
      attributes: {},
      children: [],
      tagSiblingIndex: 1,
      xpath: "/XCUIElementTypeApplication[1]",
      classChainPath: "**/XCUIElementTypeApplication[1]",
    };
  }

  return rootNode;
}

/**
 * Parses Appium XML pageSource into normalized UIElement list and hierarchy tree.
 */
export function parsePageSource(xml: string): ParseResult {
  const tree = parseXmlTree(xml);
  const elements: UIElement[] = [];
  let keyboardVisible = false;
  let systemAlert = false;

  let elementCounter = 0;

  function traverse(node: RawXmlNode) {
    const type = node.type;
    const attrs = node.attributes;

    const bounds: ElementBounds = {
      x: Number(attrs["x"] ?? "0") || 0,
      y: Number(attrs["y"] ?? "0") || 0,
      width: Number(attrs["width"] ?? "0") || 0,
      height: Number(attrs["height"] ?? "0") || 0,
    };

    const isVisible = attrs["visible"] === "true";
    const isEnabled = attrs["enabled"] !== "false";
    const traits = attrs["traits"] ?? "";
    const isSelected = traits.includes("Selected") || attrs["selected"] === "true";

    if (type === "XCUIElementTypeKeyboard" && isVisible) {
      keyboardVisible = true;
    }
    if (type === "XCUIElementTypeAlert" && isVisible) {
      systemAlert = true;
    }

    const name = attrs["name"] ?? "";
    const label = attrs["label"] ?? "";
    const value = attrs["value"] ?? "";

    const locatorCandidates = generateLocatorCandidates(type, attrs, node);
    const possibleActions = inferPossibleActions(type, attrs);

    const semanticId = computeSemanticId({
      type,
      name,
      label,
      value,
      bounds,
    });

    const element: UIElement = {
      elementId: `elem_${elementCounter++}`,
      semanticId,
      type,
      label,
      name,
      value,
      bounds,
      enabled: isEnabled,
      visible: isVisible,
      selected: isSelected,
      locatorCandidates,
      possibleActions,
      source: "accessibility",
      confidence: 1.0,
    };

    elements.push(element);

    for (const child of node.children) {
      traverse(child);
    }
  }

  traverse(tree);

  return {
    elements,
    tree,
    keyboardVisible,
    systemAlert,
  };
}

/**
 * Flattened elements directly parsed from XML string.
 */
export function parseElements(xml: string): UIElement[] {
  return parsePageSource(xml).elements;
}
