Prefixes: XD-F = feature, XD-B = bug, XD-T = tech/cleanup P4= I don't know why we need this, but GPT seems interested. P1-3= My rankings P5=Probably gonna kill this one P0= out of scope for release v1

## Versioning rules (informal)

- **Patch (0.x.y):** Bug fixes, reliability improvements, internal refactors. No new user-visible behaviors or interaction modes.
- **Minor (0.x.0):** Any new user-visible capability, interaction mode, or persistent UI behavior (e.g. FX Assign Mode, clip indicators, new settings surfaces).
- **Major (1.0.0):** Stability-complete release. No known P1 bugs, XR18 session recovers from sleep/transport loss without manual intervention, core control surfaces complete (Channel + FX), and no required workaround instructions.

## 1. Active board (for current revision)

| ID      | Title                                           | Pr | Type | Notes |
|---------|-------------------------------------------------|----|------|-------|

## 2. Feature backlog
| XD-F006 | Per-action settings UI                          | P3 |         | For each action: source selector (Ch 1–18, Bus, FX), label override, meter mode (normal/raised-floor/peaks). |
| XD-F007 | Global settings UI                              | P3 |         | Bridge host/port, meter update rate,skin, meter style, type size if accessible |
| XD-F001 | Finish tile channel configuration               | P3 | XD-T010 | User-facing feature: tiles (Channel, FX, future types) can target any XR18 source with persistent mapping; uses shared config plumbing (XD-T010). |
| XD-F009 | Configurable channel layout for FX type         | P5 | XD-F001 | Simple JSON or similar mapping so layout isn’t hard-coded (e.g. which XR18 source each tile represents). If fixed layouts are fine, you can skip this|
| XD-F004 | Basic level faders for key inputs               | P0 |         | A page where encoders act as faders for mapped channels and buttons reflect ch info and bank switching or sends. |

## 3. Bugs / regressions

Capture what you expected, what actually happened, and how to reproduce.

| ID      | Title                                           | Pr | Depends | Notes |
|---------|-------------------------------------------------|----|---------|-------|
| XD-B001 | (placeholder)                                   | P3 |         | Keep as a template row; do not delete. |

## 4. Technical / cleanup tasks

| ID      | Title                                           | Pr | Depends | Notes |
|---------|-------------------------------------------------|----|---------|-------|
| XD-T006 | Unit tests around meter decoding                | P2 |         | Sample `/meters/1` blobs mapped to expected per-channel levels to guard against regressions. |
| XD-T007 | Refactor bridge into smaller modules            | P2 |         | Split bridge into OSC transport, WebSocket transport, protocol/schema, and app entrypoint modules. |
| XD-T008 | `oscProtocol` separation and validation         | P2 |         | Centralize XR18 OSC message construction/parsing in an `oscProtocol` module and align with `wsProtocol` schemas; single validation point instead of ad-hoc shapes. |
| XD-T010 | Shared channel-config plumbing for all tiles    | P2 |         | Extract Channel Button mapping logic into a shared config module used by all tile types (Channel, FX, future fader pages). Supports XD-F001. |
| XD-T011 | SVG tile rendering engine                       | P2 |         | Introduce a small rendering module that outputs per-tile SVG images (meters, pip strips, safe-state indicators) and sends them via setImage. Enables graphical bus pips for XD-F013 Phase 2 and future unified visual layouts. |
| XD-T020 | Switch to bridge-less architecture (rev 2.0)    | P0 |         | Investigate collapsing SwiftBar bridge into Stream Dock plugin backend for public release. Goal: single install, no helper apps. Review SDK lifecycle, UDP/OSC feasibility, internal modularization, and distribution implications. See discussion re: internal backend vs external bridge. |
| XD-T004 | XR18 simulation mode                            | P5 |         | Optional mode where the bridge simulates `/meters/1` and basic channel state for development without the mixer. Only useful if you want to develop the plugin without the mixer turned on.| 
| XD-T012 | Unicode box-drawing fader rendering experiment  | P3 |         | Replace current ASCII fader bar with higher-resolution Unicode box/half-block characters to achieve smoother, more analog-feeling fader motion. Applies to faders first (meters may follow later). Hard-coded as the default (no toggle). Font/glyph inconsistencies acceptable given single-device use. Exploratory/technical task. |

## 5. Done (for future changelog)

- 2025-01-XX – XD-F014: Clip indicator with hold at top of meter. Displays `!` glyph at end of meter bar when clipping detected (local inference: raw meter value >= -1, equivalent to dB >= -0.0039). Holds for 10 seconds after last clipping detection, then auto-clears. Applies to all meter types (Channel Button, FX tiles). Clip indicator persists during OFFLINE state but clears on recovery.
- 2025-12-18 – XD-T005: Better logging and diagnostics. Standardized log message prefixes (`[PLUGIN]`, `[BRIDGE]`) for grep-ability. Added high-frequency event filtering to event spy (dialRotate filtered by default). Enhanced debug flag documentation. All Unicode characters in log strings use escapes per ARCH.md rules.
- 2025-12-18 – XD-F013: FX bus-assignment UI. FX tiles support live routing to Buses A/B/C via Assign Mode (double-tap to enter, turn to cycle, knob press to toggle + exit, safe timeout).
- 2025-12-18 – XD-F005: Knob acceleration curve overhaul. FX fader control moved to dB-domain with 0.1 dB precision near unity, smooth speed-based acceleration, stabilized multi-tick handling, and predictable behavior across the full range.
- 2025-12-18 – XD-B003: FX fader dB scale correction. Fixed FX return fader display range to match X-Air Edit exactly (−∞ to +10 dB), including correct unity behavior.
- 2025-12-18 – XD-B002: Minimal auto-recovery after transport loss. Bridge performs a one-shot STALE recovery by reasserting XR18 session and meter subscription, restoring meters after sleep or cable pull without restart.
- 2025-12-14 – XD-F010: FX knob UI refinements (expanded to 4-line layout: channel name on line 1, status/value on line 2, fader bar on line 3, meter bar on line 4; improves clarity of numeric values and supports longer channel names up to 13 characters).
- 2025-12-14 – XD-F011: Signal-present indicator in meters (bullet character \u2022 appears in first empty meter position when signal > -80 dB threshold, visible even when below visual floor; bridge computes from raw meter data, plugin stores and renders).
- 2025-12-13 – XD-T009: Globalized safe-state handling end-to-end (bridge + protocol + plugin). Formal LIVE / STALE / OFFLINE model derived from OSC receive activity + meter-frame heartbeats (WebSocket lifecycle is used for propagation only); control writes gated unless LIVE; OFFLINE/STALE UI freezes meters and blocks local "ghost" moves; clean recovery on bridge restart.
- 2025-12-13 – XD-T002: Hardened `/meters/1` decoding path. Isolated blob decode into non-throwing helper; centralized meter conversion math; bounds-safe mapping; prevents malformed meter frames from stalling bridge or locking UI.
- 2025-12-09 – XD-F012: Channel Button on-air indicator graphic (Channel Button tiles now show an on-air green glow and ON/LIVE text when unmuted, OFF SAFE when muted, and OFFLINE when the bridge is down).
- 2025-12-09 – XD-F002: Bridge starts up active (SwiftBar plugin now auto-starts the bridge on login and keeps it running unless explicitly disabled via the menu).
- 2025-12-04 – XD-F003: FX returns control surface (bi-directional control of FX return fader, mute, name, and meters).
- 2025-12-04 – XD-T001: Explicit OSC session lifecycle handling (`/xremote` + `/renew`, reconnect logic, and connection state exposed to plugin).
- 2025-12-04 – XD-F008: Graceful “no bridge” behaviour (tiles indicate offline state instead of failing silently).
- 2025-12-04 – XD-T003: Initial `wsProtocol` module created to isolate WebSocket message schema between bridge and plugin.
