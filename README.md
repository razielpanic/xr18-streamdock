# XR18FX Stream Dock Plugin

A Stream Dock plugin + Node.js bridge to control and monitor a Behringer XR18/X-Air mixer:
- FX1–4 fader control
- FX1–4 mute and metering
- Channel button control (mute + meter)
- Bridge reconnect logic with offline indicators

## Development Setup

### Plugin Location
The development copy lives in: ~/Projects/StreamDock/com.youshriek.xr18fx.sdPlugin The live plugin directory contains a symlink pointing here.

### Running the Bridge### Versioning
Use semantic-ish tags:
- v0.1.x — early work
- v0.2.x — reconnect + state sync + offline indicators

## Files
- `xr18fx.js` — plugin logic
- `xr18channel.js` — channel button logic
- `xr18fx-bridge.js` — Node.js OSC/WebSocket bridge
- `manifest.json` — plugin manifest

