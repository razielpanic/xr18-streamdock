// xr18fx.js
// Stream Dock knob plugin: sends commands over WebSocket to a local Node bridge
// that actually talks OSC to the XR18.

console.log('XR18FX: plugin script loaded');
console.log('XR18FX: typeof WebSocket =', typeof WebSocket);

// Per-action-instance state
//  - fxInstances: knob strips for FX returns
//  - channelInstances: key-based "Channel Button" tiles
const fxInstances = new Map();
const channelInstances = new Map();
let nextFxIndex = 1; // FX1..FX4 in appearance order

let sdSocket = null;
let pluginUUID = null;
let bridgeSocket = null;
let bridgeReconnectTimer = null;
let bridgeOnline = false;

function setBridgeOnline(next) {
  const changed = bridgeOnline !== next;
  bridgeOnline = next;
  if (!changed) return;

  // When we transition to offline, force all tiles to redraw so they show OFFLINE/--
  if (!bridgeOnline) {
    for (const context of fxInstances.keys()) {
      updateKnobTitle(context);
    }
    for (const context of channelInstances.keys()) {
      updateChannelTitle(context);
    }
  }
  // When transitioning to online, we rely on the bridge to push fresh state,
  // which will cause updateKnobTitle/updateChannelTitle to be called.
}

const BRIDGE_URL = "ws://127.0.0.1:18018"; // Node bridge we will run separately

const BRIDGE_RECONNECT_DELAY_MS = 1500;

function scheduleBridgeReconnect(delayMs) {
  if (bridgeReconnectTimer) {
    clearTimeout(bridgeReconnectTimer);
    bridgeReconnectTimer = null;
  }
  bridgeReconnectTimer = setTimeout(() => {
    bridgeReconnectTimer = null;
    openBridgeWebSocket();
  }, typeof delayMs === "number" ? delayMs : BRIDGE_RECONNECT_DELAY_MS);
}

function openBridgeWebSocket() {
  // Avoid duplicate connections if one is already open or connecting
  if (bridgeSocket &&
      (bridgeSocket.readyState === WebSocket.OPEN ||
       bridgeSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  console.log('XR18FX: attempting bridge WebSocket connect', BRIDGE_URL);
  try {
    bridgeSocket = new WebSocket(BRIDGE_URL);
  } catch (e) {
    console.log('XR18FX: bridge WebSocket constructor failed', e);
    setBridgeOnline(false);
    scheduleBridgeReconnect();
    return;
  }

  bridgeSocket.onopen = () => {
    setBridgeOnline(true);
    console.log('XR18FX: bridge WebSocket OPEN');
    logViaBridge('bridge_open', {});

    // Re-sync all FX instances (in case they appeared before the bridge was ready)
    for (const inst of fxInstances.values()) {
      if (typeof inst.fx === "number") {
        sendToBridge({
          type: "sync",
          fx: inst.fx
        });
      }
    }

    // Re-register all Channel Button instances so the bridge can poll them
    for (const inst of channelInstances.values()) {
      if (!inst.targetType || !inst.targetIndex) continue;
      sendToBridge({
        type: "channelRegister",
        targetType: inst.targetType,
        targetIndex: inst.targetIndex,
      });
    }
  };

  bridgeSocket.onerror = (err) => {
    console.log('XR18FX: bridge WebSocket ERROR', err);
    logViaBridge('bridge_error', { error: String(err) });
    setBridgeOnline(false);
    // onclose will handle scheduling reconnect
  };

  bridgeSocket.onclose = () => {
    setBridgeOnline(false);
    console.log('XR18FX: bridge WebSocket CLOSED');
    logViaBridge('bridge_closed', {});
    scheduleBridgeReconnect();
  };

  // Listen for state updates coming back from the bridge (OSC → bridge → plugin)
  bridgeSocket.onmessage = (evt) => {
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch (e) {
      return;
    }

    // Debug: confirm we are receiving messages from the bridge
    logViaBridge('bridge-onmessage', msg);

    if (!msg) return;

    // FX strip state updates
    if (msg.type === "state" && msg.fx) {
      // Update any FX instances that correspond to this FX index
      for (const [context, inst] of fxInstances.entries()) {
        if (inst.fx !== msg.fx) continue;

        if (msg.kind === "fader" && typeof msg.value === "number") {
          let v = Math.round(msg.value * 100);
          if (v < 0) v = 0;
          if (v > 100) v = 100;
          inst.value = v;
        }

        if (msg.kind === "mute") {
          inst.muted = !!msg.muted;
        }

        if (msg.kind === "name" && typeof msg.name === "string") {
          const trimmed = msg.name.trim();
          if (trimmed.length > 0) {
            inst.name = trimmed;
          }
        }

        if (msg.kind === "meter" && typeof msg.value === "number") {
          let m = msg.value;
          if (m < 0) m = 0;
          if (m > 1) m = 1;
          inst.meter = m;
        }

        updateKnobTitle(context);
      }
      return;
    }

    // Channel Button state updates
    if (msg.type === "channelState" && msg.targetType && msg.targetIndex) {
      const tType = msg.targetType;
      const tIndex = msg.targetIndex;
      for (const [context, inst] of channelInstances.entries()) {
        if (inst.targetType !== tType || inst.targetIndex !== tIndex) continue;

        if (typeof msg.muted === "boolean") {
          inst.muted = msg.muted;
        }
        if (typeof msg.meter === "number") {
          let m = msg.meter;
          if (m < 0) m = 0;
          if (m > 1) m = 1;
          inst.meter = m;
        }
        if (typeof msg.name === "string" && msg.name.trim().length > 0) {
          inst.name = msg.name.trim();
        }

        updateChannelTitle(context);
      }
      return;
    }
  };
}

function logViaBridge(tag, payload) {
  if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) return;
  try {
    bridgeSocket.send(JSON.stringify({
      type: "log",
      tag,
      payload
    }));
  } catch (e) {
    // ignore
  }
}

function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo) {
  console.log('XR18FX: connectElgatoStreamDeckSocket called', { inPort, inPluginUUID, inRegisterEvent });
  logViaBridge('connectElgatoStreamDeckSocket', { inPort, inPluginUUID, inRegisterEvent });
  pluginUUID = inPluginUUID;

  const url = `ws://127.0.0.1:${inPort}`;
  sdSocket = new WebSocket(url);

  sdSocket.onopen = () => {
    logViaBridge('sdSocket_open', {});
    const registration = {
      event: inRegisterEvent,
      uuid: pluginUUID,
    };
    sdSocket.send(JSON.stringify(registration));

    // Also connect to our local Node OSC bridge (with reconnect support)
    openBridgeWebSocket();
  };

  sdSocket.onmessage = (evt) => {
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch (e) {
      return;
    }

    const event = msg.event;
    const actionUUID = msg.action;

    switch (event) {
      case "willAppear":
        if (actionUUID === "com.youshriek.xr18fx") {
          handleFxWillAppear(msg);
        } else if (actionUUID === "com.youshriek.xr18channel") {
          handleChannelWillAppear(msg);
        }
        break;
      case "willDisappear":
        if (actionUUID === "com.youshriek.xr18fx") {
          handleFxWillDisappear(msg);
        } else if (actionUUID === "com.youshriek.xr18channel") {
          handleChannelWillDisappear(msg);
        }
        break;
      case "dialRotate":
        if (actionUUID === "com.youshriek.xr18fx") {
          handleDialRotate(msg);
        }
        break;
      case "dialDown":
        if (actionUUID === "com.youshriek.xr18fx") {
          handleDialDown(msg);
        }
        break;
      case "dialUp":
        if (actionUUID === "com.youshriek.xr18fx") {
          handleDialUp(msg);
        }
        break;
      case "keyDown":
        if (actionUUID === "com.youshriek.xr18channel") {
          handleChannelKeyDown(msg);
        }
        break;
      case "didReceiveSettings":
        if (actionUUID === "com.youshriek.xr18channel") {
          handleChannelDidReceiveSettings(msg);
        }
        break;
      case "sendToPlugin":
        if (actionUUID === "com.youshriek.xr18channel") {
          handleChannelConfigFromPI(msg);
        }
        break;
      default:
        break;
    }
  };

  sdSocket.onclose = () => {
    sdSocket = null;
    bridgeSocket = null;
    setBridgeOnline(false);
    if (bridgeReconnectTimer) {
      clearTimeout(bridgeReconnectTimer);
      bridgeReconnectTimer = null;
    }
  };
}

function handleFxWillAppear(msg) {
  const context = msg.context;

  // If this context already has an instance, reuse its FX mapping
  const existing = fxInstances.get(context);
  if (existing) {
    // Just request a fresh sync from the mixer and redraw
    sendToBridge({
      type: "sync",
      fx: existing.fx
    });
    updateKnobTitle(context);
    return;
  }

  // Otherwise assign the next FX index (1..4), clamped at 4
  const fx = nextFxIndex <= 4 ? nextFxIndex++ : 4;

  const inst = {
    value: 0, // 0..100 (placeholder until real state arrives)
    fx,
    muted: false,
    name: `FX${fx}`, // default label, overridden by mixer name if available
    meter: 0,       // 0.0..1.0 live signal level (from /meters/1)
  };

  fxInstances.set(context, inst);

  // Ask the bridge to immediately poll the mixer for this FX whenever it appears
  sendToBridge({
    type: "sync",
    fx
  });

  updateKnobTitle(context);
}

function handleFxWillDisappear(msg) {
  const context = msg.context;
  fxInstances.delete(context);

  // If no FX instances remain (e.g. page/profile fully hidden),
  // reset FX index assignment so the next appearance gets FX1–FX4 again.
  if (fxInstances.size === 0) {
    nextFxIndex = 1;
  }
}

function handleDialRotate(msg) {
  const context = msg.context;
  const inst = fxInstances.get(context);
  if (!inst) return;

  const ticks = msg.payload && typeof msg.payload.ticks === "number" ? msg.payload.ticks : 0;

  inst.value += ticks; // 1 tick = 1 step
  if (inst.value < 0) inst.value = 0;
  if (inst.value > 100) inst.value = 100;

  // Send fader move to bridge as 0.0..1.0
  sendToBridge({
    type: "fader",
    fx: inst.fx,
    value: inst.value / 100,
  });

  updateKnobTitle(context);
}

function handleDialDown(msg) {
  const context = msg.context;
  const inst = fxInstances.get(context);
  if (!inst) return;

  inst.muted = !inst.muted;

  sendToBridge({
    type: "mute",
    fx: inst.fx,
    on: inst.muted
  });

  updateKnobTitle(context);
}

function handleDialUp(_msg) {
  // No-op for now
}

// ---- Channel Button (Keypad) handling ----

function makeDefaultChannelInstance(context, payload) {
  const settings = (payload && payload.settings) || {};
  const targetType = "ch";
  const rawIndex = parseInt(settings.targetIndex, 10);
  const targetIndex = Number.isFinite(rawIndex) && rawIndex > 0 ? rawIndex : 1;

  return {
    context,
    targetType,
    targetIndex,
    name: "",   // from mixer
    muted: false,
    meter: 0.0,
  };
}

function handleChannelWillAppear(msg) {
  const context = msg.context;
  const payload = msg.payload || {};

  let inst = channelInstances.get(context);
  if (!inst) {
    inst = makeDefaultChannelInstance(context, payload);
    channelInstances.set(context, inst);
  }

  if (!inst.name) {
    const idx = String(inst.targetIndex).padStart(2, "0");
    inst.name = `${inst.targetType.toUpperCase()}${idx}`;
  }

  // Register with bridge so it can start polling this channel
  sendToBridge({
    type: "channelRegister",
    targetType: inst.targetType,
    targetIndex: inst.targetIndex,
  });

  updateChannelTitle(context);
}

function handleChannelWillDisappear(msg) {
  const context = msg.context;
  channelInstances.delete(context);
}

function handleChannelKeyDown(msg) {
  const context = msg.context;
  const inst = channelInstances.get(context);
  if (!inst) return;

  // Tap toggles mute
  sendToBridge({
    type: "channelToggleMute",
    targetType: inst.targetType,
    targetIndex: inst.targetIndex,
  });
}

function handleChannelDidReceiveSettings(msg) {
  const context = msg.context;
  const payload = msg.payload || {};
  const newSettings = payload.settings || {};
  let inst = channelInstances.get(context);

  if (!inst) {
    // Create a new instance from the incoming settings
    inst = makeDefaultChannelInstance(context, payload);
    channelInstances.set(context, inst);
  } else {
    const rawIndex = parseInt(newSettings.targetIndex, 10);
    const tIndex = Number.isFinite(rawIndex) && rawIndex > 0
      ? rawIndex
      : (inst.targetIndex || 1);
    inst.targetType = "ch";
    inst.targetIndex = tIndex;
  }

  // Provisional label until mixer name arrives
  const idxStr = String(inst.targetIndex).padStart(2, "0");
  if (!inst.name || /^CH\d{2}$/.test(inst.name)) {
    inst.name = `CH${idxStr}`;
  }

  // Re-register with bridge so it polls the new channel
  sendToBridge({
    type: "channelRegister",
    targetType: inst.targetType,
    targetIndex: inst.targetIndex,
  });

  updateChannelTitle(context);
}

function handleChannelConfigFromPI(msg) {
  const context = msg.context;
  const payload = msg.payload || {};

  // Some hosts wrap the PI payload, so support both shapes:
  //  - payload: { type: "channelConfig", targetIndex: N }
  //  - payload: { payload: { type: "channelConfig", targetIndex: N } }
  const cfg = payload.type ? payload : (payload.payload || payload);
  if (!cfg || cfg.type !== "channelConfig") return;

  const rawIndex = parseInt(cfg.targetIndex, 10);
  if (!Number.isFinite(rawIndex) || rawIndex < 1) return;

  let inst = channelInstances.get(context);
  if (!inst) {
    inst = {
      context,
      targetType: "ch",
      targetIndex: rawIndex,
      name: "",
      muted: false,
      meter: 0,
    };
    channelInstances.set(context, inst);
  } else {
    inst.targetType = "ch";
    inst.targetIndex = rawIndex;
  }

  const idxStr = String(inst.targetIndex).padStart(2, "0");
  inst.name = `CH${idxStr}`;

  // Re-register with bridge so it polls the new channel
  sendToBridge({
    type: "channelRegister",
    targetType: inst.targetType,
    targetIndex: inst.targetIndex,
  });

  updateChannelTitle(context);
}

function squareMeter(level, width = 8) {
  // Clamp level to [0,1]
  if (level < 0) level = 0;
  if (level > 1) level = 1;
  const filled = Math.round(level * width);
  const empty = Math.max(0, width - filled);
  const fullChar = ":";
  const emptyChar = ".";
  return fullChar.repeat(filled) + emptyChar.repeat(empty);
}

function updateKnobTitle(context) {
  if (!sdSocket) return;
  const inst = fxInstances.get(context);
  if (!inst) return;

  // Map 0..100 to 0.0..1.0
  const val01 = inst.value / 100;
  const meter01 = typeof inst.meter === "number" ? inst.meter : 0;

  // Approximate XR18-style fader range: center 0 dB around the typical unity position
  const db = (val01 - 0.75) * 80; // ≈ -60 dB at bottom, +20 dB at top

  const WIDTH_FADER = 20; // logical width of the fader bar
  const WIDTH_METER = 25; // logical width of the meter bar (can be adjusted independently)

  // Per-FX horizontal padding in spaces to visually nudge the whole block
  const fxPadLeft  = { 1: 0, 2: 0, 3: 5, 4: 5 };
  const fxPadRight = { 1: 5, 2: 0, 3: 0, 4: 0 };

  const padLeftCount  = fxPadLeft[inst.fx]  || 0;
  const padRightCount = fxPadRight[inst.fx] || 0;
  const padLeftStr  = " ".repeat(padLeftCount);
  const padRightStr = " ".repeat(padRightCount);

  // Fader position bar: ----+----
  const pos = Math.round(val01 * WIDTH_FADER);
  const faderLeft  = "-".repeat(pos);
  const faderRight = "-".repeat(Math.max(0, WIDTH_FADER - pos));
  const faderBar = `${faderLeft}+${faderRight}`;

  // Live meter bar: ####....
  const meterBar = squareMeter(meter01, WIDTH_METER);

  // Build three lines:
  //  1: name + MUTE or dB (or OFFLINE)
  //  2: fader bar
  //  3: live meter bar
  const isOffline = !bridgeOnline;

  const nameCore = isOffline
    ? "--"
    : (inst.name || `FX${inst.fx}`);

  const statusCore = isOffline
    ? "OFFLINE"
    : (inst.muted ? `MUTE` : `${db.toFixed(1)} dB`);
  const line1Core = `${nameCore} ${statusCore}`;
  const line2Core = faderBar;
  const line3Core = meterBar;

  const line1 = `${padLeftStr}${line1Core}${padRightStr}`;
  const line2 = `${padLeftStr}${line2Core}${padRightStr}`;
  const line3 = `${padLeftStr}${line3Core}${padRightStr}`;

  const title = `${line1}\n${line2}\n${line3}`;

  const payload = {
    event: "setTitle",
    context,
    payload: {
      title,
      target: 0,
    },
  };

  sdSocket.send(JSON.stringify(payload));
}

function updateChannelTitle(context) {
  if (!sdSocket) return;
  const inst = channelInstances.get(context);
  if (!inst) return;

  const isOffline = !bridgeOnline;

  const nameCore = isOffline
    ? "--"
    : (inst.name || `${inst.targetType.toUpperCase()}${String(inst.targetIndex).padStart(2, "0")}`);

  const statusCore = isOffline
    ? "OFFLINE"
    : (inst.muted ? "OFF" : "ON");

  const meterBar = squareMeter(typeof inst.meter === "number" ? inst.meter : 0, 16);

  const line1 = nameCore;
  const line2 = statusCore;
  const line3 = meterBar;

  const title = `${line1}\n${line2}\n${line3}`;

  const payload = {
    event: "setTitle",
    context,
    payload: {
      title,
      target: 0,
    },
  };

  sdSocket.send(JSON.stringify(payload));
}

function sendToBridge(msg) {
  console.log('XR18FX: sendToBridge', msg, 'readyState=', bridgeSocket && bridgeSocket.readyState);
  logViaBridge('sendToBridge', msg);
  if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) return;
  try {
    bridgeSocket.send(JSON.stringify(msg));
  } catch (e) {
    // ignore
  }
}
