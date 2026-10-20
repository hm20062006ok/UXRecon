# Task Pack A — Go/No-Go Record

Updated: 2026-10-20 (Asia/Kuala_Lumpur)

## Current decision

**GO.**

The Appium/WDA physical-device chain works, a third-party target App is approved, and the safe click → screenshot → restore → verify sequence passed 10 of 10 iterations against that App. Task Pack B may start.

## Completed evidence

- Physical iPhone detected over a wired connection.
- Pairing state is paired.
- Developer Mode is enabled.
- Appium 3.8.0 installed in the workspace.
- XCUITest driver 12.19.1 installed in the workspace-local Appium home.
- TypeScript spike compiles with strict checking.
- Appium accepted the desired capabilities and selected the physical device.
- Xcode automatic provisioning created a WDA build for the personal development team.
- `WebDriverAgentRunner-Runner` was installed on the iPhone with bundle ID `com.miaohu.uxrecon.WebDriverAgentRunner.xctrunner`.
- The developer certificate was trusted by the user.
- WDA launched successfully and Appium created a real-device session.
- Appium captured a 1284×2778 PNG screenshot and a 44 KB XCUITest page source.
- A safe Settings navigation action completed 10/10 times, including screenshot-before, screenshot-after, back and parent-page verification.
- Third-party target App selected: TokenPocket 2.30.0, `com.global.wallet.ios`.
- Third-party safe path approved: welcome page → `Market` tab → `Assets` tab, no wallet and no account required.
- Third-party safe click → screenshot → restore → parent verification completed 10/10 times.

## Remaining Task Pack A gates

- [x] Trust the WDA developer certificate on the iPhone.
- [x] Re-run the read-only probe and capture a screenshot plus page source.
- [x] Run a system-only click → screenshot → back sequence ten times (10/10 passed).
- [x] Select one third-party target App in `docs/p0-safe-test-scope.md`.
- [x] Define a reversible, side-effect-free start page and accessibility-ID click.
- [x] Run the target-App click → screenshot → back sequence ten times.
- [x] Pass at least nine of ten runs (10/10).
- [x] Change this decision to GO before starting Task Pack B.

## Evidence

System target:

- `artifacts/p0-real-device-2026-10-20T05-34-09-990Z/`
- `artifacts/p0-real-device-2026-10-20T05-34-49-306Z/`

Third-party target (TokenPocket), 10-iteration regression:

- `artifacts/p0-real-device-2026-10-20T05-46-44-165Z/`
  - `result.json` — per-iteration fingerprints, similarities, recovery levels and durations
  - `it-01..it-10-{before,after,restore-a1}.png|.xml` — screenshot and page source for every step
  - `000-calibration-*.png|.xml` — the volatile-element calibration pass

Measured on that run:

| Metric | Value |
| --- | --- |
| Passed iterations | 10 / 10 (required 9) |
| Iteration duration | min 7517 ms, median 7689 ms, max 7849 ms |
| Destination similarity to parent | 0.053 (all runs) |
| Restored similarity to parent | 1.000 (all runs) |
| Recovery level used | In-app restore tap, first attempt, 10/10 |
| App relaunch fallback | Not needed |
| Parent fingerprint stability | 1 distinct value across all 10 before-states |
| Destination fingerprint variety | 10 distinct values across 10 visits |

## Findings that changed the implementation

1. **`driver.back()` is a silent no-op on the XCUITest driver for iOS.** The first target-App run tapped a row, then "restored" with `driver.back()`. The command returned success and the app never navigated; the before-back and after-back screenshots were byte-identical. The probe no longer calls `back()`. It taps an explicit in-app restore control and falls back to an app relaunch. This is direct input for P8-T2 (recovery ladder) and P8-T1 (verify restoration, do not trust the command).
2. **SwiftUI page fingerprints must ignore anonymous layout containers.** The first restore attempt scored 0.9167 because three `XCUIElementTypeOther` containers without a name or label shifted by 44 pt after a tab round trip, even though the page was visually identical. Restricting the fingerprint to elements that carry a name/label or are real controls raised the same comparison to 1.000. This is direct input for P3-T4.
3. **Static text is not a safe tap target.** An earlier run tapped the accessibility id of a `XCUIElementTypeStaticText` ("I already have a wallet") and landed on the neighbouring row's flow. The probe now resolves a `XCUIElementTypeButton` through a predicate first and records the resolved type in `result.json`, so a non-button target is visible in the evidence rather than silently accepted. This is direct input for P2-T3.
4. **A page can carry elements that change without any interaction.** The calibration pass samples the untouched page three times and excludes any element that moves or appears between samples. On this App it excluded nothing, but the mechanism is required before the same fingerprint is used on pages with carousels, counters or live prices.

## Residual risks

- The safe path is a tab switch. It exercises session reuse, locator resolution, tap dispatch, screenshot capture, page-source capture and restore verification, but it does not exercise deep navigation, modal dismissal, keyboard handling or scroll.
- TokenPocket is a SwiftUI App with almost no accessibility identifiers; controls are addressed by `name`/`label` predicates. A future page may have duplicate labels, and the probe does not yet disambiguate by index or ancestor.
- The device is a single iPhone 13 Pro Max on iOS 27.0. Nothing here proves behaviour on other devices or OS versions.
- The app is in the no-wallet state. Once a wallet exists, the welcome page disappears and this exact path must be re-approved.

## Next step

Start Task Pack B (P1): TypeScript skeleton, config schema, doctor command, structured logging. Carry findings 1–4 into P2-T3, P3-T4, P8-T1 and P8-T2 as acceptance criteria rather than rediscovering them there.
