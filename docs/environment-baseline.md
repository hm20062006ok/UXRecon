# Phase 0 Environment Baseline

Captured: 2026-10-20 (Asia/Kuala_Lumpur)

## Host

- macOS 27.0.1 (26A434), Apple Silicon arm64
- Xcode 27.1 (27A9275)
- Node.js 26.5.0
- npm 11.17.0
- Codex CLI 0.163.0

## Physical device

- Device: iPhone 13 Pro Max (iPhone14,3)
- iOS: 27.0 (24A437)
- Connection: wired
- Pairing: paired
- Developer Mode: enabled
- UDID: `00008110…A1801E` (redacted)

Serial number, ECID, tunnel address and other device identifiers are intentionally omitted.

## Automation toolchain

- Appium: 3.8.0, workspace-local
- XCUITest driver: 12.19.1, workspace-local Appium home
- WebdriverIO: 10.1.0
- Appium home: `<workspace>/.appium`

This baseline records the initially selected versions. Compatibility is only considered proven after the WDA probe produces a successful session, screenshot and page source on the physical device.

## Reproduction commands

```bash
npm install
APPIUM_HOME="$PWD/.appium" npx appium driver install xcuitest@12.19.1

export UXR_DEVICE_UDID="<full UDID>"
export UXR_PLATFORM_VERSION="27.0"
export UXR_XCODE_ORG_ID="<Apple Developer Team ID>"
export UXR_WDA_BUNDLE_ID="<unique WDA bundle ID>"
export UXR_ALLOW_PROVISIONING_DEVICE_REGISTRATION=1

npm run p0:doctor
npm run p0:appium
# In a second terminal:
npm run p0:probe
```

## Current validation status

| Check | Status |
| --- | --- |
| Physical device visible to `devicectl` | Pass |
| Wired connection and pairing | Pass |
| Developer Mode enabled | Pass |
| Appium installed | Pass |
| XCUITest driver installed | Pass |
| WDA built and installed | Pass |
| WDA developer certificate trusted | Pass |
| WDA launched | Pass |
| Screenshot captured through Appium | Pass |
| Page source captured through Appium | Pass |
| System safe click and return repeated 10 times | Pass — 10/10 |
| Third-party target safe path | Pass — 10/10 (TokenPocket, Market ↔ Assets) |

## Driver behaviour notes

Observed on this combination (Appium 3.8.0 + XCUITest 12.19.1 + iOS 27.0):

- `driver.back()` is not implemented for iOS and returns success without navigating. Any restore logic must tap an in-app control and verify the result, never trust the return value.
- WDA reports `visible="true"` for offscreen carousel pages. Geometry must be filtered in addition to the visibility flag.
- Anonymous SwiftUI layout containers (`XCUIElementTypeOther` without name or label) move between visually identical states and must be excluded from page fingerprints.

## Successful probe evidence

- Read-only probe: `artifacts/p0-real-device-2026-10-20T05-34-09-990Z/`
- Ten-iteration navigation probe: `artifacts/p0-real-device-2026-10-20T05-34-49-306Z/`
- Ten-iteration result: 10 successful click → screenshot → back → parent verification cycles.
- Third-party ten-iteration probe (TokenPocket): `artifacts/p0-real-device-2026-10-20T05-46-44-165Z/`
- Third-party ten-iteration result: 10/10, restore similarity 1.000 each run, median 7.7 s per iteration.

