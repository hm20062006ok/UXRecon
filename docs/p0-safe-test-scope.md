# Phase 0 Safe Test Scope

This file is the approval record for P0-T4. The probe may only run its click phase with the values recorded here.

## Selected target

| Field | Value |
| --- | --- |
| App | TokenPocket 2.30.0 (build 2) |
| Bundle ID | `com.global.wallet.ios` |
| Install state | Installed on the test device, no wallet created |
| Account | None. The app is in its no-wallet onboarding state; no login, no chain account, no assets |
| Starting page | Welcome / onboarding page — headline "Your Multi-chain Wallet, Safe & Easy", two entry rows ("I already have a wallet", "I don't have a wallet") and a 5-item tab bar (Assets, Market, Trade, Discover, Me) |
| How the start page is reached | Cold launch (`mobile: terminateApp` + `mobile: launchApp`). The probe always relaunches so a previous run cannot leak state into the next one |
| Safe control to tap | Accessibility ID `Market` — `XCUIElementTypeButton`, frame `x=88 y=844 w=81 h=48` |
| Expected destination | Market tab: public token list with search, category chips and a watchlist prompt. Read-only market data, no wallet required, no server write |
| Expected return behaviour | Tap accessibility ID `Assets` → welcome page restored, `Assets` tab selected again |
| Data classification | No test account. No wallet, no password, no mnemonic, no private key, no chain account and no server-side record is created by this path |

## Verified navigation contract

| Property | Observation |
| --- | --- |
| Target resolves as a real control | `-ios predicate string:type == "XCUIElementTypeButton" AND name == "Market"` |
| Tap produces a visible state change | Page fingerprint similarity to the parent page: `0.053` on all 10 runs |
| Restoration is verifiable, not assumed | On-screen element similarity to the parent page: `1.000` on all 10 runs |
| Parent page is byte-stable | The parent fingerprint was identical before all 10 iterations (`19ce5c272969d6b6` in the 1-shot run, stable per run) |
| Destination is not static | The Market fingerprint differed on all 10 visits, which confirms the tap really reached live market content instead of a cached frame |
| Recovery ladder needed | Level 1 only — in-app `Assets` tap, first attempt, 10/10 |

Evidence: `artifacts/p0-real-device-2026-10-20T05-46-44-165Z/` (`result.json` plus before/after/restore screenshots and page sources for all 10 iterations).

## Rejected candidates

| Candidate | Why rejected |
| --- | --- |
| "I don't have a wallet" | Enters the wallet creation flow, which writes local wallet data. Observed once by accident during an earlier probe run; no password was entered and no wallet was created, and the app was relaunched to the welcome page |
| "I already have a wallet" | Enters the import flow. It only shows import options, but it leads toward mnemonic / private key / keystore entry, so it is too close to forbidden territory for a repeatable regression |
| Tab "Me" | Contains settings entry points; a mis-tap there is one step from account and security surfaces |
| Tab "Trade" / "Discover" | Both can open third-party DApp or web content, which leaves the target-app boundary |
| Any `XCUIElementTypeStaticText` label as a tap target | SwiftUI text nodes are not real controls. An earlier run tapped the text "I already have a wallet" and landed on the neighbouring row, so text nodes are not accepted as safe tap targets |

## Always forbidden during Phase 0

- Sending a message, meeting invite, form or public communication;
- Creating, changing or deleting cloud data;
- Purchasing, subscribing, transferring, swapping or signing;
- Changing credentials, permissions or account security;
- Entering OTPs, recovery phrases, private keys, payment data or identity documents;
- Accepting an unexpected system permission;
- Coordinate-based clicking;
- Tapping any element that is not a resolved `XCUIElementTypeButton` / `Cell` / `Switch` control.

## P0-T3 execution gate

The probe is read-only by default. It may execute clicks only when `UXR_ALLOW_SAFE_TAP=1`; the click phase is now unconditional inside `p0:probe` only because the target and restore IDs default to the approved pair below.

```bash
export UXR_ALLOW_SAFE_TAP=1
export UXR_SAFE_TAP_ACCESSIBILITY_ID="Market"
export UXR_SAFE_TAP_RESTORE_ACCESSIBILITY_ID="Assets"
export UXR_SAFE_TAP_ITERATIONS=10
```

The approved target must stay a reversible, side-effect-free navigation control. The probe captures before/after screenshots and page sources, performs the in-app restore, then verifies the parent page by fingerprint. If the restore fails it retries once, then relaunches the app, and if that also fails it stops the run as `blocked` instead of guessing a tap. P0-T3 passes only when at least 9 of 10 iterations pass.
