# StreamDeck SDK vs Mirabox StreamDock SDK vs Manual Implementation Comparison

This document compares three approaches to Stream Dock plugin development:
1. **Elgato StreamDeck SDK (v2)** - Official SDK for Elgato Stream Deck hardware
2. **Mirabox StreamDock Plugin SDK** - Official SDK for Stream Dock hardware (the device this project targets)
3. **Manual/raw implementation** - Current XR18 plugin approach (raw JavaScript without SDK helpers)

This is an exploratory comparison only—no formal adoption or migration is implied.

---

## Executive Summary

**Elgato StreamDeck SDK (v2)**: Modern TypeScript/Node.js SDK with automatic lifecycle management, decorators, and structured event handling. Designed for Elgato Stream Deck hardware.

**Mirabox StreamDock Plugin SDK**: Official SDK for Stream Dock hardware, available in multiple language variants (JavaScript/Chromium, Node.js, Python, C++, Qt, Vue). Provides helper classes but still uses manual WebSocket management. This is the recommended SDK for Stream Dock device development.

**Manual Implementation (XR18 Plugin)**: Raw JavaScript implementation without SDK helpers, using direct WebSocket communication and manual state management. Maximum control but maximum boilerplate.

**Key Relationship**: The XR18 plugin uses the same protocol as Mirabox StreamDock SDK but implements it manually without the SDK's helper classes. Mirabox SDK provides a middle ground between full abstraction (like Elgato SDK) and raw implementation.

---

## 1. Architecture Overview

### StreamDeck SDK Architecture

**Runtime Model:**
- **Plugin Backend**: Node.js 20+ (TypeScript/JavaScript compiled to JS)
- **Property Inspector**: Chromium-based UI
- **Communication**: WebSocket managed by SDK (automatic port discovery, reconnection)
- **Code Structure**: Class-based actions with decorators, automatic registration

```
┌─────────────────────────────────────┐
│   Stream Deck Application (Host)    │
│                                     │
│  ┌──────────────┐  ┌──────────────┐ │
│  │  Plugin      │  │  Property    │ │
│  │  (Node.js)   │◄─┤  Inspector   │ │
│  │              │  │  (Chromium)  │ │
│  └──────────────┘  └──────────────┘ │
│         ▲                 ▲         │
│         └────────┬────────┘         │
│                  │                  │
│        ┌─────────▼──────────┐       │
│        │  WebSocket (SDK)   │       │
│        └────────────────────┘       │
└─────────────────────────────────────┘
```

### Mirabox StreamDock SDK Architecture

**Runtime Model (JavaScript variant):**
- **Plugin**: Embedded Chromium runtime (JavaScript directly in HTML)
- **SDK**: Helper classes (`Plugins`, `Actions`) for state management
- **Communication**: Manual WebSocket setup via `connectElgatoStreamDeckSocket`, but with helper methods
- **Code Structure**: Class-based helpers with manual event routing

**Runtime Model (Node.js variant):**
- **Plugin**: Node.js process (separate executable)
- **SDK**: Same helper classes (`Plugins`, `Actions`) adapted for Node.js
- **Communication**: WebSocket via `process.argv` (port passed by host)
- **Code Structure**: Class-based helpers, similar API to JavaScript variant

```
┌──────────────────────────────────────────┐
│     Stream Dock Host (VSDinside)         │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  Plugin (Chromium or Node.js)      │  │
│  │  - Mirabox SDK Helpers             │  │
│  │  - Plugins/Actions classes         │  │
│  └─────┬──────────────────────────────┘  │
│        │                                 │
│        │ WebSocket                       │
│        │ (SD Protocol)                   │
│        ▼                                 │
│  ┌──────────────┐                        │
│  │ StreamDock   │                        │
│  │ Host WS      │                        │
│  └──────────────┘                        │
└──────────────────────────────────────────┘
```

**Key Features**:
- Official SDK for Stream Dock hardware
- Multiple language variants (JS, Node.js, Python, C++, Qt, Vue)
- Helper classes reduce boilerplate while maintaining control
- Same WebSocket protocol as manual implementation

### Manual Implementation (XR18 Plugin) Architecture

**Runtime Model:**
- **Plugin**: Embedded Chromium runtime (JavaScript directly in HTML)
- **Bridge**: External Node.js process (separate WebSocket server for OSC/XR18)
- **Communication**: Manual WebSocket management, explicit reconnection logic
- **Code Structure**: Functional/procedural JavaScript, manual event routing, no SDK helpers

```
┌──────────────────────────────────────────┐
│     VSDinside StreamDock (Host)          │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  Plugin (Chromium/HTML/JS)         │  │
│  │  - index.html + xrDock.js          │  │
│  │  - Manual WebSocket handling       │  │
│  └─────┬──────────────────────┬───────┘  │
│        │                      │          │
│        │ WebSocket            │ WebSocket│
│        │ (SD Protocol)        │ (Bridge) │
│        ▼                      ▼          │
│  ┌──────────────┐      ┌─────────────┐   │
│  │ StreamDock   │      │ Node Bridge │   │
│  │ Host WS      │      │ (OSC/XR18)  │   │
│  └──────────────┘      └─────────────┘   │
└──────────────────────────────────────────┘
```

**Key Difference**: This is a raw implementation without SDK helpers. Uses the same protocol as Mirabox SDK but implements everything manually (Maps for state, manual event routing, etc.).

---

## 2. Communication Protocol

### StreamDeck SDK Protocol

**Connection Handling:**
- SDK automatically discovers port and connects
- Built-in reconnection logic
- Automatic registration with host

```typescript
import streamDeck from "@elgato/streamdeck";
streamDeck.connect(); // That's it - SDK handles everything
```

**Message Format:**
```typescript
// SDK abstracts messages as typed events
{
  event: "keyDown",
  action: "com.company.plugin.action",
  context: "action-instance-uuid",
  device: "device-uuid",
  payload: {
    settings: {},
    coordinates: { column: 0, row: 0 },
    state: 0
  }
}
```

**Event Handling:**
- Decorator-based action classes
- Type-safe event objects
- Automatic lifecycle management

```typescript
@action({ UUID: "com.company.plugin.action" })
export class MyAction extends SingletonAction<Settings> {
  override async onKeyDown(ev: KeyDownEvent<Settings>) {
    // SDK provides typed event with settings pre-loaded
    const { count } = ev.payload.settings;
    await ev.action.setTitle(`Count: ${count}`);
  }
}
```

### Mirabox StreamDock SDK Protocol

**Connection Handling (JavaScript variant):**
- Manual WebSocket setup via `connectElgatoStreamDeckSocket()` callback (same as manual)
- SDK provides helper classes but connection is still manual
- Helper methods extend WebSocket prototype

```javascript
window.connectElgatoStreamDeckSocket = function () {
  const uuid = arguments[1], event = arguments[2];
  window.info = JSON.parse(arguments[3]);
  window.socket = new WebSocket("ws://127.0.0.1:" + arguments[0]);
  
  window.socket.onopen = () => 
    window.socket.send(JSON.stringify({ uuid, event }));
  
  // SDK extends WebSocket with helper methods
  WebSocket.prototype.setTitle = function(context, str, row, num) { /* ... */ };
  WebSocket.prototype.setImage = function(context, url) { /* ... */ };
  // ... more helpers
};
```

**Connection Handling (Node.js variant):**
- Port passed via `process.argv[3]` (host-managed)
- WebSocket created in `Plugins` constructor
- Automatic registration on connection

```javascript
class Plugins {
  constructor() {
    this.ws = new ws("ws://127.0.0.1:" + process.argv[3]);
    this.ws.on('open', () => 
      this.ws.send(JSON.stringify({ 
        uuid: process.argv[5], 
        event: process.argv[7] 
      }))
    );
  }
}
```

### Manual Implementation Protocol

**Connection Handling:**
- Manual WebSocket setup via `connectElgatoStreamDeckSocket()` callback
- Explicit registration message
- Manual reconnection with timers
- No SDK helpers - pure JavaScript

```javascript
function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo) {
  const url = `ws://127.0.0.1:${inPort}`;
  sdSocket = new WebSocket(url);
  
  sdSocket.onopen = () => {
    sdSocket.send(JSON.stringify({
      event: inRegisterEvent,
      uuid: pluginUUID,
    }));
  };
}
```

**Message Format:**
- Identical JSON structure (same protocol, different SDK)
- Direct message parsing and routing
- Manual state tracking

```javascript
sdSocket.onmessage = (evt) => {
  const msg = JSON.parse(evt.data);
  switch (msg.event) {
    case "willAppear":
      handleFxWillAppear(msg);
      break;
    case "dialRotate":
      handleDialRotate(msg);
      break;
    // ... manual routing
  }
};
```

**State Management:**
- Manual Maps for instance tracking
- Explicit context-based routing
- No automatic lifecycle

```javascript
const fxInstances = new Map(); // Manual instance storage

function handleFxWillAppear(msg) {
  const context = msg.context;
  const inst = { fx: 1, value: 0, muted: false };
  fxInstances.set(context, inst);
}
```

**Similarity**: Both use the same underlying WebSocket JSON protocol—StreamDeck SDK just wraps it in a TypeScript/class-based API.

---

## 3. Action Development Patterns

### StreamDeck SDK Approach

**Class-Based Actions:**
```typescript
@action({ UUID: "com.company.plugin.action" })
export class CounterAction extends SingletonAction<Settings> {
  override async onWillAppear(ev: WillAppearEvent<Settings>) {
    // Automatic: settings loaded, action initialized
    await ev.action.setTitle("Ready");
  }
  
  override async onKeyDown(ev: KeyDownEvent<Settings>) {
    // Automatic: settings available, type-safe
    let { count = 0 } = ev.payload.settings;
    count++;
    await ev.action.setSettings({ count });
    await ev.action.setTitle(`${count}`);
  }
  
  override async onWillDisappear(ev: WillDisappearEvent) {
    // Automatic cleanup (can override for custom cleanup)
  }
}
```

**Features:**
- Automatic settings persistence (via `ev.action.setSettings()`)
- Type-safe settings objects
- Decorator-based registration
- Singleton pattern built-in (all instances share state automatically)

### Mirabox StreamDock SDK Approach

**Class-Based Helpers:**
```javascript
const plugin = new Plugins("xxx");

plugin.action1 = new Actions({
  default: {}, // Default settings
  _willAppear({ context }) {
    window.socket.setTitle(context, "Hello world!");
  },
  _willDisappear({ context }) { },
  dialRotate(data) {
    console.log(data);
  },
  dialDown(data) {
    console.log(data);
  }
});
```

**SDK Helper Methods:**
```javascript
// SDK provides helper methods on WebSocket
window.socket.setTitle(context, "Title");
window.socket.setImage(context, "data:image/...");
window.socket.setState(context, 1);
window.socket.setSettings(context, { key: "value" });
window.socket.sendToPropertyInspector(payload);
```

**Features:**
- Helper classes (`Plugins`, `Actions`) for organization
- Automatic settings management via `Actions.data[context]`
- Helper methods reduce boilerplate (setTitle, setImage, etc.)
- Still uses manual WebSocket connection
- Event routing via action name matching

**Node.js Variant:**
```javascript
const { Plugins, Actions, log } = require('./utils/plugin');
const plugin = new Plugins('demo');

plugin.demo = new Actions({
  default: {},
  async _willAppear({ context, payload }) {
    // SDK manages this.data[context] automatically
    let n = 0;
    timers[context] = setInterval(() => {
      plugin.setImage(context, svg);
    }, 1000);
  },
  _willDisappear({ context }) {
    clearInterval(timers[context]);
  }
});
```

### Manual Implementation Approach

**Functional/Procedural Actions:**
```javascript
// Manual instance tracking
const fxInstances = new Map();

function handleFxWillAppear(msg) {
  const context = msg.context;
  const inst = {
    fx: nextFxIndex++,
    value: 0,
    muted: false,
    name: `FX${nextFxIndex}`,
  };
  fxInstances.set(context, inst);
  updateKnobTitle(context);
}

function handleDialRotate(msg) {
  const context = msg.context;
  const inst = fxInstances.get(context);
  if (!inst) return;
  
  // Manual state update
  inst.value += delta;
  sendToBridge({ type: "setFxFader", fxIndex: inst.fx, value: inst.value });
  updateKnobTitle(context);
}

// Manual WebSocket message sending
function setTitle(context, title) {
  sdSocket.send(JSON.stringify({
    event: "setTitle",
    context,
    payload: { title, target: 0 }
  }));
}
```

**Features:**
- Manual instance management (Maps with context as key)
- Manual settings persistence (via `setSettings` event)
- Explicit state synchronization
- No SDK helpers - everything is raw WebSocket JSON
- Full control but maximum boilerplate

**Similarity**: All three approaches support multiple action instances per plugin. Elgato SDK automates everything; Mirabox SDK provides helpers; Manual implementation does everything manually.

---

## 4. Manifest Structure

### StreamDeck SDK Manifest

```json
{
  "$schema": "https://schemas.elgato.com/streamdeck/plugins/manifest.json",
  "UUID": "com.company.pluginname",
  "Name": "Plugin Name",
  "Version": "1.0.0.0",
  "SDKVersion": 2,
  "CodePath": "bin/plugin.js",
  "Nodejs": {
    "Version": "20",
    "Debug": "enabled"
  },
  "Actions": [
    {
      "UUID": "com.company.pluginname.action",
      "Name": "Action Name",
      "Controllers": ["Keypad", "Encoder"],
      "PropertyInspectorPath": "ui/action.html",
      "States": [
        { "Image": "imgs/actions/action/key" }
      ]
    }
  ]
}
```

**Features:**
- Schema validation (`$schema` field)
- Explicit SDK version (`SDKVersion: 2`)
- Node.js version specification
- Controller types explicitly listed

### Mirabox StreamDock SDK Manifest

**JavaScript Variant:**
```json
{
  "SDKVersion": 1,
  "Author": "MiraBox",
  "Name": "插件名称",
  "CodePath": "plugin/index.html",
  "Version": "1.0.0",
  "Actions": [
    {
      "UUID": "com.hotspot.streamdock.xxx.action1",
      "Name": "行动名称",
      "Controllers": ["Keypad", "Information", "Knob"],
      "PropertyInspectorPath": "propertyInspector/action1/index.html",
      "States": [{ "Image": "static/default.jpg" }]
    }
  ]
}
```

**Node.js Variant:**
```json
{
  "SDKVersion": 1,
  "Author": "MiraBox",
  "Name": "demo",
  "CodePathWin": "plugin/index.js",
  "CodePathMac": "plugin/index.js",
  "Nodejs": { "Version": "20" },
  "Version": "1.0.0",
  "Actions": [
    {
      "UUID": "com.mirabox.streamdock.demo.demo",
      "Name": "demo",
      "Controllers": [],
      "PropertyInspectorPath": "propertyInspector/demo/index.html",
      "States": [{ "Image": "static/App-logo.png" }]
    }
  ]
}
```

**Features:**
- `SDKVersion: 1` (protocol version)
- `CodePath` for JavaScript (HTML file)
- `CodePathWin`/`CodePathMac` for Node.js (JS file)
- Supports multiple controllers per action
- Optional `Nodejs` section for Node.js variant

### Manual Implementation Manifest

```json
{
  "Name": "XR18 Control Surface",
  "Author": "You Shriek",
  "Version": "0.5.0",
  "SDKVersion": 1,
  "CodePath": "index.html",
  "Actions": [
    {
      "UUID": "com.youshriek.xr18fx",
      "Name": "XR18 Control Knob",
      "Controllers": ["Knob"],
      "States": [
        { "Image": "blank.png" }
      ]
    }
  ]
}
```

**Features:**
- Same structure as Mirabox SDK (compatible protocol)
- `CodePath` points to HTML (Chromium runtime)
- Minimal structure (no SDK-specific fields needed)
- No Node.js version (plugin runs in Chromium)

**Similarity**: All three use JSON manifests with similar fields. Mirabox and Manual use the same protocol/SDKVersion, so manifests are nearly identical.

---

## 5. Property Inspector / UI

### StreamDeck SDK Property Inspector

**Approach:**
- Optional `sdpi-components` library for styled UI components
- TypeScript/JavaScript
- Automatic connection via SDK helpers

```html
<!doctype html>
<html>
<head>
  <script src="../sdpi-components.js"></script>
</head>
<body>
  <sdpi-item label="Label">
    <sdpi-textfield setting="label"></sdpi-textfield>
  </sdpi-item>
</body>
</html>
```

```javascript
const { streamDeckClient } = SDPIComponents;
// Already connected and registered
await streamDeckClient.setSettings({ label: "New Value" });
```

### VSDinside StreamDock Property Inspector

**Approach:**
- Manual WebSocket connection (same as plugin)
- Raw HTML/CSS/JavaScript
- Explicit message sending

```html
<!DOCTYPE html>
<html>
<body>
  <input type="text" id="targetIndex">
  <button onclick="saveSettings()">Save</button>
  <script src="index.js"></script>
</body>
</html>
```

```javascript
function saveSettings() {
  const targetIndex = document.getElementById('targetIndex').value;
  sdSocket.send(JSON.stringify({
    event: "setSettings",
    context: pluginContext,
    payload: { settings: { targetIndex } }
  }));
}
```

**Similarity**: Both use HTML/JS for property inspectors. StreamDeck provides components library; StreamDock uses manual implementation.

---

## 6. Settings Persistence

### StreamDeck SDK

**Automatic Persistence:**
```typescript
// Settings automatically saved and loaded
override async onKeyDown(ev: KeyDownEvent<Settings>) {
  const settings = ev.payload.settings; // Auto-loaded
  await ev.action.setSettings({ count: settings.count + 1 }); // Auto-saved
}
```

**Settings Flow:**
- Settings loaded on `onWillAppear`
- Settings available in all event handlers
- `setSettings()` persists automatically
- Type-safe via TypeScript generics

### Mirabox StreamDock SDK

**SDK-Managed Settings:**
```javascript
plugin.action1 = new Actions({
  default: { count: 0 }, // Default settings
  _willAppear({ context, payload: { settings } }) {
    // SDK automatically manages: this.data[context] = { ...default, ...settings }
    // Access via: this.data[context]
  },
  keyDown({ context }) {
    // Update settings
    this.data[context].count++;
    window.socket.setSettings(context, this.data[context]);
  }
});
```

**Settings Flow:**
- SDK's `Actions` class manages `this.data[context]` automatically
- Default settings merged with persisted settings on `willAppear`
- Must explicitly call `setSettings()` to persist changes
- No type safety (plain JavaScript)

### Manual Implementation

**Manual Persistence:**
```javascript
// Settings must be explicitly requested and saved
function handleWillAppear(msg) {
  const context = msg.context;
  const settings = msg.payload.settings || {};
  // Manual storage
  const inst = { ...defaultSettings, ...settings };
  fxInstances.set(context, inst);
}

function saveSettings(context, settings) {
  sdSocket.send(JSON.stringify({
    event: "setSettings",
    context: context,
    payload: { settings }
  }));
}
```

**Settings Flow:**
- Manual Maps for instance data
- Must explicitly send `setSettings` to persist
- No type safety
- Full control over storage structure

**Similarity**: All support settings persistence via `setSettings` event. Elgato SDK fully automates; Mirabox SDK provides helpers; Manual implementation requires explicit calls.

---

## 7. Visual Feedback (setTitle, setImage, etc.)

### StreamDeck SDK

**Async/Await API:**
```typescript
await ev.action.setTitle("Hello");
await ev.action.setImage("data:image/png;base64,...");
await ev.action.setState(1);
await ev.action.showOk(); // Success indicator
await ev.action.showAlert(); // Error indicator
```

**Rate Limiting:**
- SDK handles rate limits internally
- 10 updates/second per action (enforced by host)

### Mirabox StreamDock SDK

**SDK Helper Methods:**
```javascript
// JavaScript variant
window.socket.setTitle(context, "Title", row, num);
window.socket.setImage(context, "data:image/...");
window.socket.setState(context, 1);
window.socket.setSettings(context, settings);

// Node.js variant
plugin.setTitle(context, "Title", row, num);
plugin.setImage(context, "data:image/...");
plugin.setState(context, 1);
plugin.setSettings(context, settings);
```

**Rate Limiting:**
- Manual awareness required (same 10/sec limit)
- Must implement debouncing/throttling manually
- Helper methods wrap JSON serialization but don't handle rate limiting

### Manual Implementation

**Direct WebSocket Send:**
```javascript
function setTitle(context, title) {
  sdSocket.send(JSON.stringify({
    event: "setTitle",
    context: context,
    payload: { title, target: 0 }
  }));
}
```

**Rate Limiting:**
- Manual awareness required (same 10/sec limit)
- Must implement debouncing/throttling manually
- Everything is explicit - no helpers at all

**Similarity**: Same underlying protocol (`setTitle`, `setImage`, `setState`). Elgato SDK provides async API; Mirabox SDK provides helper methods; Manual uses raw JSON.

---

## 8. Event Lifecycle

### StreamDeck SDK

**Automatic Lifecycle:**
```
onWillAppear → User Events → onWillDisappear
     ↓                           ↓
  Settings                    Cleanup
  loaded                    (automatic)
```

**Event Types:**
- `onWillAppear` / `onWillDisappear`
- `onKeyDown` / `onKeyUp`
- `onDialRotate` / `onDialDown` / `onDialUp`
- `onTouchTap` (Stream Deck +)
- `onDidReceiveSettings`
- `onPropertyInspectorDidAppear`

**Features:**
- Automatic cleanup on `onWillDisappear`
- Settings loaded before `onWillAppear`
- Type-safe event payloads

### VSDinside StreamDock

**Manual Lifecycle:**
```javascript
// Manual routing in onmessage handler
switch (msg.event) {
  case "willAppear":
    handleFxWillAppear(msg);
    break;
  case "willDisappear":
    handleFxWillDisappear(msg);
    // Manual cleanup required
    fxInstances.delete(msg.context);
    break;
}
```

**Event Types:**
- Same events (protocol compatibility)
- Manual handling required
- No automatic cleanup

**Similarity**: Same event names and lifecycle. SDK automates; StreamDock requires manual handling.

---

## 9. Error Handling & Logging

### StreamDeck SDK

**Built-in Logger:**
```typescript
import streamDeck from "@elgato/streamdeck";

streamDeck.logger.info("Message");
streamDeck.logger.warn("Warning");
streamDeck.logger.error("Error");
```

**Error Handling:**
```typescript
try {
  await performAction();
  await ev.action.showOk();
} catch (error) {
  streamDeck.logger.error(error.message);
  await ev.action.showAlert();
}
```

### VSDinside StreamDock

**Console Logging:**
```javascript
console.log('XR18FX: plugin script loaded');
console.log('XR18FX: bridge WebSocket ERROR', err);
```

**Manual Error Handling:**
```javascript
try {
  sendToBridge({ type: "setFxFader", fxIndex: fx, value: v });
} catch (e) {
  console.log('XR18FX: send failed', e);
  // Manual error state handling
}
```

**Similarity**: Both support logging. SDK provides structured logger; StreamDock uses console.

---

## 10. State Management & Multi-Instance

### StreamDeck SDK

**Singleton Pattern:**
```typescript
export class CounterAction extends SingletonAction<Settings> {
  // All instances share the same class instance
  // Access all visible instances:
  override async onKeyDown(ev: KeyDownEvent) {
    this.actions.forEach(action => {
      action.setTitle("Updated");
    });
  }
}
```

**Instance Tracking:**
- SDK automatically tracks all instances
- `this.actions` provides all visible instances
- Settings are per-instance (via `ev.action`)

### VSDinside StreamDock

**Manual Maps:**
```javascript
const fxInstances = new Map(); // context -> instance data

function handleFxWillAppear(msg) {
  const context = msg.context;
  fxInstances.set(context, { fx: 1, value: 0 });
}

// Update specific instance
function updateKnobTitle(context) {
  const inst = fxInstances.get(context);
  setTitle(context, inst.name);
}
```

**Instance Tracking:**
- Manual Maps with context as key
- Must track lifecycle manually
- Must handle cleanup on `willDisappear`

**Similarity**: Both support multiple instances per action. SDK automates tracking; StreamDock uses Maps.

---

## 11. External Communication (Bridge Pattern)

### StreamDeck SDK

**No Built-in Bridge:**
- SDK focuses on plugin ↔ host communication
- External services handled via standard Node.js APIs (fetch, WebSocket, etc.)
- No bridge abstraction

**Example:**
```typescript
// Direct API calls from plugin
const response = await fetch('https://api.example.com/data');
const data = await response.json();
```

### VSDinside StreamDock

**Explicit Bridge Pattern:**
```javascript
// Plugin connects to external bridge (separate Node.js process)
const BRIDGE_URL = "ws://127.0.0.1:18018";
bridgeSocket = new WebSocket(BRIDGE_URL);

// Bridge handles OSC/XR18 communication
sendToBridge({
  type: "setFxFader",
  fxIndex: inst.fx,
  value: value01,
});
```

**Bridge Implementation:**
- Separate Node.js process (`xrDock-bridge.js`)
- Handles OSC/UDP communication with XR18 mixer
- WebSocket server for plugin connections
- Custom protocol over WebSocket

**Key Difference**: StreamDock architecture separates plugin UI (Chromium) from control logic (Node bridge). StreamDeck plugin runs entirely in Node.js, so external communication is direct.

---

## 12. Type Safety & Development Experience

### StreamDeck SDK

**TypeScript First:**
- Full TypeScript support
- Type-safe events and settings
- IDE autocomplete and type checking

```typescript
type CounterSettings = {
  count: number;
  label: string;
};

@action({ UUID: "com.company.action" })
export class CounterAction extends SingletonAction<CounterSettings> {
  override async onKeyDown(ev: KeyDownEvent<CounterSettings>) {
    const { count, label } = ev.payload.settings; // Typed!
  }
}
```

**Build System:**
- Rollup/webpack for bundling
- TypeScript compilation
- Source maps for debugging

### VSDinside StreamDock

**JavaScript:**
- Plain JavaScript (no type safety)
- Manual type checking/documentation
- Runtime errors possible

```javascript
// No type safety
function handleDialRotate(msg) {
  const ticks = msg.payload && typeof msg.payload.ticks === "number" 
    ? msg.payload.ticks 
    : 0; // Manual validation
}
```

**Development:**
- Direct file editing
- No build step (HTML + JS loaded directly)
- Console-based debugging

**Similarity**: Both support JavaScript. StreamDeck encourages TypeScript; StreamDock uses plain JS.

---

## 13. Key Similarities

1. **Same WebSocket Protocol**: Both use identical JSON message format (compatible protocol)
2. **Same Event Names**: `willAppear`, `keyDown`, `dialRotate`, etc.
3. **Same Message Types**: `setTitle`, `setImage`, `setState`, `setSettings`
4. **Same Manifest Structure**: JSON with UUID, Actions, etc.
5. **Multi-Instance Support**: Both handle multiple action instances
6. **Property Inspector**: Both use HTML/JS for settings UI
7. **Controller Types**: Both support Keypad, Encoder/Dial/Knob

---

## 14. Key Differences

| Aspect | Elgato StreamDeck SDK | Mirabox StreamDock SDK | Manual Implementation |
|--------|----------------------|----------------------|---------------------|
| **Runtime** | Node.js (separate process) | Chromium or Node.js (user choice) | Chromium (embedded) |
| **Language** | TypeScript (compiled) | JavaScript (direct) | JavaScript (direct) |
| **Code Structure** | Class-based with decorators | Class-based helpers | Functional/procedural |
| **State Management** | Automatic (SDK) | Helper classes (`Actions.data`) | Manual (Maps) |
| **Settings** | Auto-loaded/saved | Helper-managed (merge defaults) | Manual request/save |
| **Connection** | Automatic (SDK) | Manual WebSocket setup | Manual WebSocket setup |
| **Reconnection** | Built-in | Manual (if needed) | Manual timers |
| **Type Safety** | Full TypeScript | None | None |
| **Error Handling** | Structured logger | Console.log | Console.log |
| **Build Step** | Required (TS→JS) | None (direct JS/HTML) | None (direct HTML) |
| **Bridge Pattern** | Direct API calls | Direct or Bridge (user choice) | Separate Node process |
| **Lifecycle** | Automatic cleanup | SDK helpers (partial) | Manual cleanup |
| **Rate Limiting** | Handled by SDK | Manual awareness | Manual awareness |
| **Helper Methods** | Full async API | Helper methods on WS/plugin | None (raw JSON) |
| **Platform** | Elgato Stream Deck | Stream Dock (Mirabox) | Stream Dock (Mirabox) |

---

## 15. Design Philosophy Comparison

### Elgato StreamDeck SDK

**Philosophy:**
- **Abstraction over Control**: SDK handles boilerplate, developer focuses on logic
- **Type Safety**: Compile-time errors preferred over runtime errors
- **Convention over Configuration**: Defaults handle common cases
- **Modern Tooling**: TypeScript, async/await, decorators

**Trade-offs:**
- ✅ Faster development
- ✅ Fewer bugs (type safety)
- ✅ Better IDE support
- ❌ Less control over low-level details
- ❌ Learning curve (TypeScript, decorators)
- ❌ Different platform (Elgato hardware)

### Mirabox StreamDock SDK

**Philosophy:**
- **Helpers over Full Abstraction**: Provide utility classes without hiding protocol
- **Flexibility**: Multiple language variants, runtime choices
- **Control**: Manual connection, explicit settings, but helpers reduce boilerplate
- **Transparency**: Protocol still visible, helpers are convenience wrappers

**Trade-offs:**
- ✅ Reduces boilerplate (helpers)
- ✅ Still maintains protocol visibility
- ✅ Multiple language options
- ✅ Official SDK for Stream Dock
- ❌ Still requires manual connection setup
- ❌ No type safety
- ❌ Partial abstraction (not as complete as Elgato SDK)

### Manual Implementation

**Philosophy:**
- **Explicit over Implicit**: Manual control over all aspects
- **Simplicity**: No build step, no SDK dependencies
- **Flexibility**: Can implement any pattern manually
- **Transparency**: Direct access to protocol messages, no abstraction layer

**Trade-offs:**
- ✅ Full control
- ✅ No SDK dependencies
- ✅ Easy to understand (no abstraction)
- ✅ Direct protocol access
- ❌ Maximum boilerplate code
- ❌ No type safety
- ❌ Manual state management
- ❌ More error-prone (no helpers)

---

## 16. When Each Approach Makes Sense

### Elgato StreamDeck SDK Best For:
- Elgato Stream Deck hardware (different device)
- New plugins with standard patterns
- TypeScript projects
- Teams wanting type safety
- Complex plugins with many actions
- Projects needing rapid development

### Mirabox StreamDock SDK Best For:
- Stream Dock hardware (official SDK)
- Plugins needing helper methods without full abstraction
- Projects wanting to reduce boilerplate while maintaining control
- Multi-language development (JS, Node.js, Python, C++, Qt, Vue)
- Projects where protocol visibility is important
- Teams comfortable with manual WebSocket but wanting helpers

### Manual Implementation Best For:
- Learning the protocol deeply (complete transparency)
- Maximum control requirements
- Custom architectures (like bridge patterns)
- Quick prototypes with no dependencies
- JavaScript-only projects
- When SDK helpers aren't needed or desired
- Legacy/maintenance of existing raw implementations

---

## 17. Migration Considerations (Theoretical)

If migrating from StreamDock to StreamDeck SDK:

**Easy to Port:**
- Event handlers (`onKeyDown` → `onKeyDown`)
- Message formats (same protocol)
- Manifest structure (minimal changes)

**Requires Refactoring:**
- Manual Maps → Class-based actions
- Procedural code → OOP with decorators
- JavaScript → TypeScript
- Manual state → SDK-managed state
- Bridge pattern → Direct API calls (or keep bridge)

**Would Need to Add:**
- Build system (TypeScript compilation)
- Type definitions
- Class structure
- SDK initialization

**Would Lose:**
- Direct Chromium runtime (move to Node.js)
- Manual control over WebSocket lifecycle
- Simplicity of no-build workflow

---

## 18. Insights & Observations

### What Elgato StreamDeck SDK Does Well:
1. **Reduces Boilerplate**: Automatic lifecycle, settings, reconnection
2. **Type Safety**: Catches errors at compile time
3. **Modern Patterns**: Async/await, decorators, generics
4. **Developer Experience**: IDE support, autocomplete, docs
5. **Full Abstraction**: Hides protocol complexity completely

### What Mirabox StreamDock SDK Does Well:
1. **Balanced Approach**: Helpers without hiding protocol
2. **Multiple Languages**: JS, Node.js, Python, C++, Qt, Vue variants
3. **Official Support**: Official SDK for Stream Dock hardware
4. **Flexibility**: Choose Chromium or Node.js runtime
5. **Reduces Boilerplate**: Helper methods for common operations
6. **Protocol Visibility**: Can still see/understand underlying messages

### What Manual Implementation Does Well:
1. **Complete Transparency**: See exactly what messages are sent/received
2. **Maximum Flexibility**: Implement any pattern (bridge, custom state, etc.)
3. **Simplicity**: No build step, no dependencies, direct execution
4. **Full Control**: Every aspect is explicit and controllable
5. **Learning Tool**: Best way to understand the protocol deeply

### Shared Strengths:
- Same protocol (Stream Dock variants) means plugins are protocol-compatible
- All support complex multi-action plugins
- All handle controller diversity (keys, dials, touch)
- All use WebSocket JSON messaging

### Areas Where They Diverge:
- **Abstraction Level**: Elgato fully abstracts, Mirabox partially abstracts, Manual exposes all
- **Runtime Model**: Elgato (Node.js), Mirabox (JS or Node.js), Manual (Chromium)
- **Type Safety**: Elgato (TypeScript), others (JavaScript)
- **Helper Methods**: Elgato (full API), Mirabox (partial helpers), Manual (none)
- **Platform**: Elgato (different hardware), Mirabox/Manual (Stream Dock)

---

## 19. Relationship Between Approaches

**Important Discovery**: The current XR18 plugin uses the **same protocol** as Mirabox StreamDock SDK, but implements it manually without SDK helpers. This means:

1. **Protocol Compatibility**: XR18 plugin is protocol-compatible with Mirabox SDK
2. **Potential Migration Path**: Could adopt Mirabox SDK helpers without changing protocol
3. **Same Platform**: Both target Stream Dock hardware (Mirabox device)
4. **Different Abstraction Levels**: Manual (raw) vs SDK (helpers) vs Elgato (full abstraction)

**Mirabox SDK is the "middle ground"**: It provides helpers (like Elgato SDK) but maintains protocol visibility (like manual implementation).

## Conclusion

Three approaches solve plugin development with different abstraction levels:

- **Elgato StreamDeck SDK**: Modern, type-safe, fully automated, convention-based (different hardware platform)
- **Mirabox StreamDock SDK**: Official SDK with helper classes, balanced abstraction, multiple language variants (Stream Dock hardware)
- **Manual Implementation**: Raw JavaScript, maximum control, protocol-transparent, no dependencies (Stream Dock hardware)

**For Stream Dock Development:**
- **Use Mirabox SDK** if you want helpers without losing protocol visibility
- **Use Manual** if you need maximum control or are learning the protocol
- **Don't use Elgato SDK** (different hardware platform)

**For the XR18 Plugin Specifically:**
- Currently uses manual approach (same protocol as Mirabox SDK)
- Could adopt Mirabox SDK helpers to reduce boilerplate
- Would maintain same protocol and compatibility
- Would gain helper methods (`setTitle`, `setImage`, etc.) without changing architecture significantly

The choice depends on:
- Abstraction needs (helpers vs full control)
- Platform (Elgato vs Stream Dock)
- Development preferences (TypeScript vs JavaScript, helpers vs raw)
- Architecture requirements (bridge patterns, custom state management)

