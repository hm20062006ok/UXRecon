# UXRecon (iPhone UX Explorer)

> Autonomous, bounded, and recoverable iPhone application UX exploration powered by pluggable AI Agents (OpenCode, Claude, Codex) and Appium / XCUITest.

---

## Overview

UXRecon explores third-party, closed-source iOS applications connected via USB on a physical iPhone. Starting from any specified initial screen, it iteratively:

1. **Captures** high-resolution screenshots and accessibility hierarchies (XCUITest XML);
2. **Normalizes** UI controls, filters non-interactive containers, and computes stable fingerprints;
3. **Plans** actions via pluggable AI Agents (OpenCode, Claude, Codex) or deterministic fallback rules;
4. **Executes** interactions (tap, scroll, type, back) with locator fallback and recovery ladders;
5. **Generates** comprehensive design replication specs, design tokens, Apple HIG accessibility audits, and an interactive, standalone offline screenshot gallery.

---

## Key Features

- **Real iPhone Control**: Direct integration with Appium, XCUITest driver, and WebDriverAgent on real iOS devices.
- **Pluggable AI Agents**: Native support for **OpenCode**, **Claude CLI**, **Codex CLI**, or custom CLI agents, with automatic fallback to a deterministic DFS planner.
- **Full Exploration Loop**: Depth-bounded navigation stack, transition tracking, structural fingerprinting, and automatic backtrack recovery.
- **UI & UX Extraction**:
  - **Screen Specs**: Component hierarchy with bounding boxes (`screen-specs/<page>.json`).
  - **Design Tokens**: Spacing scale, radii, and common component sizing (`design-tokens.json`).
  - **UX & Accessibility Audit**: Apple HIG 44×44 pt touch target and VoiceOver compliance audit (`ux-audit.json`).
  - **Offline Gallery**: Standalone browser gallery with cards, timings, and routes (`gallery.html`).
- **Safety First**: Full logging with sensitive UDID/credential redacting, dry-run simulation mode, and optional configurable deny/confirm keywords.

---

## Prerequisites

1. **macOS** with **Xcode & Command Line Tools** installed (`xcode-select --install`).
2. **Node.js** >= 22 (`node -v`).
3. **Appium 3.x** and **XCUITest driver** (`appium driver list`).
4. **Physical iPhone** connected via USB, paired, with Developer Mode enabled.
5. (Optional) **OpenCode CLI** (`opencode`), **Claude CLI**, or **Codex CLI**.

---

## Quickstart

### 1. Installation

```bash
git clone <repo-url>
cd UXRecon
npm install
```

### 2. Configuration

Copy the example configuration to `config.yaml` and fill in your device UDID and target app bundle ID:

```bash
cp config.example.yaml config.yaml
```

Example `config.yaml`:

```yaml
schemaVersion: 1

device:
  udid: 00008110-001544EC36A1801E
  name: "My iPhone"
  platformVersion: "27.0"

app:
  bundleId: com.global.wallet.ios

appium:
  host: 127.0.0.1
  port: 4723
  basePath: /
  xcodeOrgId: YOUR_TEAM_ID
  updatedWDABundleId: com.yourname.uxrecon.WebDriverAgentRunner

agent:
  provider: opencode # opencode | claude | codex | custom | none
  command: opencode
```

### 3. Environment Doctor

Verify your macOS, Xcode, Appium, connected iPhone, and AI Agent toolchain:

```bash
npm run doctor
```

### 4. Run Exploration

```bash
# Real device exploration (e.g. up to 10 pages, 20 actions)
npm run explore -- --max-pages 10 --max-actions 20

# Dry-run simulation (plans and captures without device write commands)
npm run explore -- --dry-run --max-pages 5 --max-actions 10
```

---

## Viewing Results

Every exploration run outputs to `runs/<project>/<run-id>/`:

- `gallery.html`: Open directly in any browser to review the visual story and flow.
- `screen-specs/`: High-fidelity JSON component layouts for UI reproduction.
- `design-tokens.json`: Inferred design scales (spacing, sizing).
- `ux-audit.json`: Apple HIG accessibility evaluation.
- `logs/exploration.jsonl`: Machine-readable execution trace.

---

## Development & Testing

```bash
npm run test         # Run all 139 unit & contract tests (Vitest)
npm run typecheck    # Strict TypeScript compiler verification
npm run lint         # ESLint check
npm run format:check # Prettier code style check
npm run build        # Build production bundle
```

---

## License

MIT
