Prefixes: XD-F = feature, XD-B = bug, XD-T = tech/cleanup P4= I don't know why we need this, but Chappie seems interested. P1-3= My rankings P5=Probably gonna kill this one

## 1. Active board (for current revsion)

| ID      | Title                                           | Pr | Type | Notes |
|---------|-------------------------------------------------|----|------|-------|
| XD-T002 | Meter decoding module                           | P2 | tech | Foundation for meters + F011 |
| XD-F011 | Signal-present indicator                        | P1 | feat | Depends on T002 |
| XD-T010 | Shared channel-config plumbing                  | P2 | tech | Enables F001 |
| XD-F010 | FX knob UI refinements                          | P1 | feat | Independent |

## 2. Feature backlog

| ID      | Title                                           | Pr | Depends | Notes |
|---------|-------------------------------------------------|----|---------|-------|
| XD-F011 | Meter signal-present indicator                  | P1 | XD-T002 | Add a minimal “signal present” cue at the very bottom of the dotmeter so activity is visible even with a raised floor / hidden low range (e.g. a baseline pixel/LED that lights whenever recent signal exceeds the noise floor). |
| XD-F010 | FX knob UI refinements                          | P1 |         | Refine layout for clarity of numeric value and longer channel name. we can definiely fit another line or so. |
| XD-F012 | Knob accelleration curve                        | P1 |         | Universal scaling math for smooth accelleration; fine control slow, zippy control fast|
| XD-F004 | Basic level faders for key inputs               | P3 |         | A page where encoders act as faders for mapped channels and buttons reflect ch info and bank switching or sends. |
| XD-F006 | Per-action settings UI                          | P3 |         | For each action: source selector (Ch 1–18, Bus, FX), label override, meter mode (normal/raised-floor/peaks). |
| XD-F007 | Global settings UI                              | P3 |         | Bridge host/port, meter update rate,skin, meter style, type size if accessible |
| XD-F001 | Finish tile channel configuration               | P3 | XD-T010 | User-facing feature: tiles (Channel, FX, future types) can target any XR18 source with persistent mapping; uses shared config plumbing (XD-T010). |
| XD-F009 | Configurable channel layout for FX type         | P5 | XD-F001 | Simple JSON or similar mapping so layout isn’t hard-coded (e.g. which XR18 source each tile represents). If fixed layouts are fine, you can skip this|

## 3. Bugs / regressions

Capture what you expected, what actually happened, and how to reproduce.

| ID      | Title                                           | Pr | Depends | Notes |
|---------|-------------------------------------------------|----|---------|-------|
| XD-B001 | (none logged yet)                               | P3 |         | Placeholder row; replace with the first real bug you encounter. |

## 4. Technical / cleanup tasks

| ID      | Title                                           | Pr | ? | Depends | Notes |
|---------|-------------------------------------------------|----|---|---------|-------|
| XD-T005 | Better logging and diagnostics                  | P2 |   |         | Structured logs for OSC and WebSocket traffic + connection state, with configurable log levels. |
| XD-T006 | Unit tests around meter decoding                | P2 |   |         | Sample `/meters/1` blobs mapped to expected per-channel levels to guard against regressions. |
| XD-T007 | Refactor bridge into smaller modules            | P2 |   |         | Split bridge into OSC transport, WebSocket transport, protocol/schema, and app entrypoint modules. |
| XD-T008 | `oscProtocol` separation and validation         | P2 |   |         | Centralize XR18 OSC message construction/parsing in an `oscProtocol` module and align with `wsProtocol` schemas; single validation point instead of ad-hoc shapes. |
| XD-T002 | Meter decoding module                           | P2 |   |         | Dedicated module that decodes `/meters/1` into per-channel levels with smoothing/raised floor. |
| XD-T009 | Globalize “safe state” indicator                | P2 |   |         | A safe refactor that formalizes connection state and extends current indicator into a tri-state model. Distinguish LIVE / STALE / OFFLINE states based on OSC/WebSocket heartbeats. LIVE: meters updating. STALE: meters frozen/dim with last-known values. OFFLINE: indicator and no control changes sent. On initial connect, fetch XR18 state and update UI without pushing unsolicited changes back to the mixer. |
| XD-T010 | Shared channel-config plumbing for all tiles    | P2 |   |         | Extract Channel Button mapping logic into a shared config module used by all tile types (Channel, FX, future fader pages). Supports XD-F001. |
| XD-T004 | XR18 simulation mode                            | P5 |   |         | Optional mode where the bridge simulates `/meters/1` and basic channel state for development without the mixer. Only useful if you want to develop the plugin without the mixer turned on.| 

## 5. Done (for future changelog)

- 2025-12-09 – XD-F012: Channel Button on-air indicator graphic (Channel Button tiles now show an on-air green glow and ON/LIVE text when unmuted, OFF SAFE when muted, and OFFLINE when the bridge is down).
- 2025-12-09 – XD-F002: Bridge starts up active (SwiftBar plugin now auto-starts the bridge on login and keeps it running unless explicitly disabled via the menu).
- 2025-12-04 – XD-F003: FX returns control surface (bi-directional control of FX return fader, mute, name, and meters).
- 2025-12-04 – XD-T001: Explicit OSC session lifecycle handling (`/xremote` + `/renew`, reconnect logic, and connection state exposed to plugin).
- 2025-12-04 – XD-F008: Graceful “no bridge” behaviour (tiles indicate offline state instead of failing silently).
- 2025-12-04 – XD-T003: Initial `wsProtocol` module created to isolate WebSocket message schema between bridge and plugin.

## Dependency Graph

```mermaid
graph TD

%% TECH TASKS
XD-T002["XD-T002\nMeter decoding module"]
XD-T005["XD-T005\nBetter logging & diagnostics"]
XD-T006["XD-T006\nUnit tests around meter decoding"]
XD-T007["XD-T007\nRefactor bridge into smaller modules"]
XD-T008["XD-T008\noscProtocol separation & validation"]
XD-T009["XD-T009\nGlobalize safe-state indicator"]
XD-T010["XD-T010\nShared channel-config plumbing"]
XD-T004["XD-T004\nXR18 simulation mode"]

%% FEATURES
XD-F011["XD-F011\nMeter signal-present indicator (P1)"]
XD-F010["XD-F010\nFX knob UI refinements (P1)"]
XD-F012["XD-F012\nKnob acceleration curve (P1)"]
XD-F004["XD-F004\nBasic level faders (P3)"]
XD-F006["XD-F006\nPer-action settings UI (P3)"]
XD-F007["XD-F007\nGlobal settings UI (P3)"]
XD-F001["XD-F001\nFinish tile channel configuration (P3)"]
XD-F009["XD-F009\nConfigurable FX channel layout (P5)"]

%% DEPENDENCIES
XD-T002 --> XD-F011
XD-T010 --> XD-F001
XD-F001 --> XD-F009

``` 
