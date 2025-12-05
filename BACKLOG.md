ID prefixes: XD-F = feature, XD-B = bug, XD-T = tech/cleanup

## 1. Active board

| ID      | Title                                           | Pr | Type | Status  | Notes |
|---------|-------------------------------------------------|----|------|---------|-------|
| XD-F001 | Finish tile channel configuration               | P1 | feat | next    | Each Channel Button/FX tile can target any XR18 source (ch/bus/FX) with persistent mapping. |
| XD-T002 | Meter decoding module                           | P2 | tech | backlog | Dedicated module that decodes `/meters/1` into per-channel levels with smoothing/raised floor. |
| XD-F002 | Bridge starts up active                         | P1 | feat | next    | swiftbar should start the bridge when the mac starts up |

## 2. Feature backlog

| ID     | Title                                            | Pr | Notes |
|--------|--------------------------------------------------|----|-------|
| XD-F002 | FX knob UI refinements                          | P2 | we can definiely fit another line or so. refine layout for clarity of numeric value |
| XD-F004 | Basic level faders for key inputs               | P4 | A page where encoders act as faders for mapped channels and buttons reflect ch info and bank switching or sends. |
| XD-F005 | Global “safe state” indicator                   | P1 | Distinguish LIVE / STALE / OFFLINE states based on OSC/WebSocket heartbeats. LIVE: meters updating normally. STALE: meters frozen/dim after a timeout but last-known values still shown. OFFLINE: clear banner/indicator and no control changes sent. On initial connect, fetch XR18 state and update UI without pushing unsolicited changes back to the mixer. |
| XD-F006 | Per-action configuration UI                     | P3 | For each action: source selector (Ch 1–18, Bus, FX), label override, meter mode (normal/raised-floor/peaks). |
| XD-F007 | Global settings screen                          | P4 | Bridge host/port, meter update rate, and option to disable meters on low-power setups. |
| XD-F009 | Configurable channel layout                     | P4 | Simple JSON or similar mapping so layout isn’t hard-coded (e.g. which XR18 source each tile represents). |

## 3. Bugs / regressions

Capture what you expected, what actually happened, and how to reproduce.

| ID      | Title                                           | Pr | Status  | Notes |
|---------|-------------------------------------------------|----|---------|-------|
| XD-B001 | (none logged yet)                               | P3 | backlog | Placeholder row; replace with the first real bug you encounter. |

## 4. Technical / cleanup tasks

| ID      | Title                                           | Pr | Status  | Notes |
|---------|-------------------------------------------------|----|---------|-------|
| XD-T008 | `oscProtocol` separation and validation         | P2 | backlog | Centralize XR18 OSC message construction/parsing in an `oscProtocol` module and align with `wsProtocol` schemas; single validation point instead of ad-hoc shapes. |
| XD-T004 | XR18 simulation mode                            | P4 | backlog | Optional mode where the bridge simulates `/meters/1` and basic channel state for development without the mixer. |
| XD-T005 | Better logging and diagnostics                  | P1 | backlog | Structured logs for OSC and WebSocket traffic + connection state, with configurable log levels. |
| XD-T006 | Unit tests around meter decoding                | P2 | backlog | Sample `/meters/1` blobs mapped to expected per-channel levels to guard against regressions. |
| XD-T007 | Refactor bridge into smaller modules            | P2 | backlog | Split bridge into OSC transport, WebSocket transport, protocol/schema, and app entrypoint modules. |


## 5. Done (for future changelog)

- 2025-12-04 – XD-F003: FX returns control surface (bi-directional control of FX return fader, mute, name, and meters).
- 2025-12-04 – XD-T001: Explicit OSC session lifecycle handling (`/xremote` + `/renew`, reconnect logic, and connection state exposed to plugin).
- 2025-12-04 – XD-F008: Graceful “no bridge” behaviour (tiles indicate offline state instead of failing silently).
- 2025-12-04 – XD-T003: Initial `wsProtocol` module created to isolate WebSocket message schema between bridge and plugin.
