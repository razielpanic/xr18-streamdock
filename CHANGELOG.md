# Changelog

## 0.6.0 Unreleased

- XD-F014: Clip indicator with hold at top of meter. Displays `!` glyph at end of meter bar when clipping detected (local inference: raw meter value >= -1, equivalent to dB >= -0.0039). Holds for 10 seconds after last clipping detection, then auto-clears. Applies to all meter types (Channel Button, FX tiles). Clip indicator persists during OFFLINE state but clears on recovery.
- XD-T005: Better logging and diagnostics. Standardized log message prefixes (`[PLUGIN]`, `[BRIDGE]`) for grep-ability across runs. Added high-frequency event filtering to event spy (dialRotate filtered by default). Enhanced debug flag documentation with clear noise levels and use cases. All Unicode characters in executable code use escapes per ARCH.md rules.

## v0.5.0 — FX assignment + fader feel + transport resilience

- XD-F013: FX bus-assignment UI. FX tiles now support live routing to Buses A/B/C directly from the Stream Dock. Double-press enters Assign Mode, rotate cycles buses, and press toggles assignment to named bus.
- XD-F005: Knob acceleration overhaul for FX faders. Fader movement is now dB-domain with 0.1 dB precision near unity, smooth speed-based acceleration, and predictable behavior across the full range. Improves both fine control and fast traversal.
- XD-B003: FX fader scale correction. Fixed FX return fader range to match X-Air Edit exactly (−∞ to +10 dB), including correct unity behavior and numeric readout alignment.
- XD-B002 (minimal): One-shot automatic recovery from STALE meter state. When OSC control remains alive but meter traffic stalls (e.g. sleep or cable pull), the bridge reasserts the XR18 session and meter subscription once per STALE episode, restoring meters without restart.
- Logging: Reduced default log noise in both plugin and bridge by gating high-frequency debug output behind explicit flags.

## v0.4.0 — FX UI refinements + signal presence indicators
- XD-F010: FX knob UI refinements. Expanded FX tiles to a four-line layout: channel name, status/value, fader bar, and meter bar. Improves legibility of numeric values and supports longer channel names without truncation.
- XD-F011: Signal-present indicator in meters. Added a persistent signal-present glyph when audio exceeds a noise floor, ensuring low-level signal activity remains visible even when meters appear idle.

## v0.3.1 — Bridge auto-start + on-air indicator
- Added SwiftBar-based auto-start for the XR18 bridge on login, with an explicit disable flag so the bridge can be stopped and kept down when needed.
- Updated Channel Button tiles to show a clear on-air state (green glow + `ON` text when unmuted, `OFF` when muted, and `OFFLINE` when the bridge is disconnected).
- Ensured manifest and plugin state wiring support per-state images for Channel Buttons and removed the unused `xr18channel.js` file.

## v0.3.0 — xrDock rename + FX protocol consolidation
- Renamed core plugin/bridge and manifest/launcher paths from `xr18fx*.js` to `xrDock*.js` 
- Consolidated FX and channel messaging on explicit protocol types: FX now uses `fxState`/`setFxFader`/`setFxMute`, and the Channel Button uses `channelState`, instead of the generic `state` + `kind` shape.
- Introduced `wsProtocol.js` at the plugin root as the single source of truth for WebSocket message types/shapes, and aligned runtime traffic so each entity (FX vs channel) has a clear, separate state shape that is easier to reason about and extend.

## v0.2.0 — Reconnect + Offline Indicators
- Added full reconnect logic for bridge WebSocket
- Added offline/-- indicators for FX and Channel tiles
- Forced redraw on offline transition
- Moved plugin to dedicated development directory
- Added symlink-based installation workflow
- Added `.gitignore` for Node/macOS/editor artifacts

## v0.1.x — Initial Work
- FX1–4 control + meters
- Channel Button control + meters
- Basic OSC/WebSocket bridge
