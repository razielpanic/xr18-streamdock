# Changelog

## v0.3.0 — xrDock rename + FX protocol consolidation

- Renamed core plugin/bridge and manifest/launcher paths from `xr18fx*.js` to `xrDock*.js` 
- Consolidated FX and channel messaging on explicit protocol types: FX now uses `fxState`/`setFxFader`/`setFxMute`, and the Channel Button uses `channelState`, instead of the generic `state` + `kind` shape.
- Aligned runtime traffic with `wsProtocol.js` so each entity (FX vs channel) has a clear, separate state shape that is easier to reason about and extend.

## v0.2.0 — Reconnect + Offline Indicators
...
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
