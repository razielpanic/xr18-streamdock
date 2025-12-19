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

let bridgeSafeState = 'OFFLINE'; // OFFLINE | STALE | LIVE (from bridge)

function setBridgeSafeState(next) {
  const changed = bridgeSafeState !== next;
  bridgeSafeState = next;
  if (!changed) return;

  // Auto-exit assign mode on STALE or OFFLINE
  if (next === 'STALE' || next === 'OFFLINE') {
    for (const [context, inst] of fxInstances.entries()) {
      if (inst.assignMode !== null) {
        exitAssignMode(context);
      }
    }
  }

  // Any transition should force redraw across tiles.
  for (const context of fxInstances.keys()) {
    updateKnobTitle(context);
  }
  for (const context of channelInstances.keys()) {
    updateChannelTitle(context);
  }
}

function setBridgeOnline(next) {
  const changed = bridgeOnline !== next;
  bridgeOnline = next;
  if (!changed) return;

  // On any transition (offline or online), force all tiles to redraw
  // so they can update OFFLINE/-- or resume normal labels/metering.
  for (const context of fxInstances.keys()) {
    updateKnobTitle(context);
  }
  for (const context of channelInstances.keys()) {
    updateChannelTitle(context);
  }
}

const BRIDGE_URL = "ws://127.0.0.1:18018"; // Node bridge we will run separately

const BRIDGE_RECONNECT_DELAY_MS = 1500;

// Debug: forward a concise trace of raw Stream Dock input events to the bridge log.
// Leave false for normal use.
const DEBUG_SD_INPUT_EVENTS = true;

// Debug: log every control message sent to the bridge (very noisy)
const DEBUG_BRIDGE_SEND = false;

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

    // Conservative: assume STALE until the bridge explicitly reports LIVE.
    setBridgeSafeState('STALE');

    // New protocol-style handshake and full-state request
    sendToBridge({
      type: "hello",
      clientId: pluginUUID || "stream-dock-plugin",
      protocolVersion: 1,
    });
    sendToBridge({
      type: "requestFullState",
    });

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
    setBridgeSafeState('OFFLINE');
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

    // Debug: bridge message echo is extremely noisy; keep disabled by default.
    // logViaBridge('bridge-onmessage', msg);

    if (!msg) return;

    // Bridge connection/safe-state (OFFLINE | STALE | LIVE)
    if (msg.type === 'connectionState' && typeof msg.state === 'string') {
      setBridgeSafeState(msg.state);
      return;
    }

    // FX strip state updates (protocol-style fxState)
    if (msg.type === "fxState" && msg.fxIndex) {
      const fxIndex = msg.fxIndex;

      for (const [context, inst] of fxInstances.entries()) {
        if (inst.fx !== fxIndex) continue;

        if (typeof msg.fader === "number") {
          let v = msg.fader * 100;
          if (v < 0) v = 0;
          if (v > 100) v = 100;
          inst.value = v;
          inst.lastSentValue01 = null; // external update: allow next local send immediately
          inst.lastSentAtMs = 0;        // reset throttle so next local send is not delayed
        }

        if (typeof msg.mute === "boolean") {
          inst.muted = msg.mute;
        }

        if (typeof msg.name === "string") {
          const trimmed = msg.name.trim();
          if (trimmed.length > 0) {
            inst.name = trimmed;
          }
        }

        if (typeof msg.meter === "number") {
          let m = msg.meter;
          if (m < 0) m = 0;
          if (m > 1) m = 1;
          inst.meter = m;
        }

        if (typeof msg.signalPresent === "boolean") {
          inst.signalPresent = msg.signalPresent;
        }

        if (typeof msg.busA === "boolean") {
          inst.busA = msg.busA;
        }

        if (typeof msg.busB === "boolean") {
          inst.busB = msg.busB;
        }

        if (typeof msg.busC === "boolean") {
          inst.busC = msg.busC;
        }

        // Optional: paired stereo bus display names (02/04/06)
        if (typeof msg.busAName === "string") {
          const s = msg.busAName.trim();
          if (s.length > 0) inst.busAName = s;
        }
        if (typeof msg.busBName === "string") {
          const s = msg.busBName.trim();
          if (s.length > 0) inst.busBName = s;
        }
        if (typeof msg.busCName === "string") {
          const s = msg.busCName.trim();
          if (s.length > 0) inst.busCName = s;
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
        if (typeof msg.signalPresent === "boolean") {
          inst.signalPresent = msg.signalPresent;
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

    if (DEBUG_SD_INPUT_EVENTS) {
      const p = msg.payload || {};
      logViaBridge('sdEvent', {
        event,
        action: actionUUID,
        context: msg.context,
        controller: p.controller,
        coordinates: p.coordinates,
        ticks: p.ticks,
        pressed: p.pressed,
      });
    }

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
          // Physical knob presses use dialDown (per SDK)
          logViaBridge('dialDown_fx_tile', { context: msg.context, payload: msg.payload });
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
        } else if (actionUUID === "com.youshriek.xr18fx") {
          // For knob controllers, keyDown is used for screen area taps (per SDK: taps are keyDown events)
          logViaBridge('keyDown_fx_tile', { context: msg.context, payload: msg.payload });
          handleFxKeyDown(msg);
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
    lastSentValue01: null, // last 0..1 value sent to bridge (for de-dupe)
    lastSentAtMs: 0,       // ms timestamp of last fader write sent to bridge (throttle)
    fx,
    muted: false,
    name: `FX${fx}`, // default label, overridden by mixer name if available
    meter: 0,       // 0.0..1.0 live signal level (from /meters/1)
    signalPresent: false, // true when signal exceeds noise floor threshold
    busA: false,    // FX Return → Bus A (mixbus 01) assignment
    busB: false,    // FX Return → Bus B (mixbus 03) assignment
    busC: false,    // FX Return → Bus C (mixbus 05) assignment
    // Display-only: show stereo-pair bus names (your convention stores names on the 2nd bus of each pair)
    busAName: 'BUS 2', // paired bus label (mixbus 02)
    busBName: 'BUS 4', // paired bus label (mixbus 04)
    busCName: 'BUS 6', // paired bus label (mixbus 06)
    assignMode: null, // null | 'A' | 'B' | 'C' | 'EXIT'
    assignModeTimeout: null, // timeout ID for auto-exit
    // Gesture state
    pressHadRotate: false, // true if a press was used to rotate (press+rotate modifier)
    suppressNextDialUp: false, // one-shot: suppress mute toggle on the next dialUp (e.g. after Assign Mode press)
    lastDialDownAt: 0,      // ms timestamp of last dialDown (for double-press detection)
    pendingMuteTimer: null, // timeout ID for delayed mute toggle

    // Dial acceleration timing (XD-F005)
    lastDialRotateAt: 0,    // ms timestamp of last dialRotate processed for fader movement
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
  const inst = fxInstances.get(context);
  if (inst && inst.assignModeTimeout) {
    clearTimeout(inst.assignModeTimeout);
    inst.assignModeTimeout = null;
  }
  if (inst && inst.pendingMuteTimer) {
    clearTimeout(inst.pendingMuteTimer);
    inst.pendingMuteTimer = null;
  }
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
  const isPressed = !!(msg.payload && msg.payload.pressed);

  // If the host provides `pressed: true` during rotation, treat it as a modifier to enter/cycle Assign Mode.
  if (isPressed) {
    inst.pressHadRotate = true;

    // Enter Assign Mode if not already in it
    if (inst.assignMode === null) {
      inst.assignMode = 'A';
    }

    if (ticks !== 0) {
      const steps = Math.abs(ticks);
      const dir = ticks > 0 ? 1 : -1;
      for (let i = 0; i < steps; i++) {
        if (dir > 0) {
          inst.assignMode = inst.assignMode === 'A' ? 'B'
            : inst.assignMode === 'B' ? 'C'
            : inst.assignMode === 'C' ? 'EXIT'
            : 'A';
        } else {
          inst.assignMode = inst.assignMode === 'A' ? 'EXIT'
            : inst.assignMode === 'EXIT' ? 'C'
            : inst.assignMode === 'C' ? 'B'
            : 'A';
        }
      }
    }

    // Reset timeout on interaction
    if (inst.assignModeTimeout) {
      clearTimeout(inst.assignModeTimeout);
    }
    inst.assignModeTimeout = setTimeout(() => {
      inst.assignModeTimeout = null;
      exitAssignMode(context);
    }, ASSIGN_MODE_TIMEOUT_MS);

    updateKnobTitle(context);
    return;
  }

  // In Assign Mode, rotate cycles the selection instead of changing the fader.
  if (inst.assignMode !== null) {
    // (ticks already computed above)
    if (ticks !== 0) {
      // Normalize to direction only; multiple ticks just advances multiple steps.
      const steps = Math.abs(ticks);
      const dir = ticks > 0 ? 1 : -1;
      for (let i = 0; i < steps; i++) {
        if (dir > 0) {
          // A → B → C → EXIT → A
          inst.assignMode = inst.assignMode === 'A' ? 'B'
            : inst.assignMode === 'B' ? 'C'
            : inst.assignMode === 'C' ? 'EXIT'
            : 'A';
        } else {
          // A ← B ← C ← EXIT ← A (reverse cycle)
          inst.assignMode = inst.assignMode === 'A' ? 'EXIT'
            : inst.assignMode === 'EXIT' ? 'C'
            : inst.assignMode === 'C' ? 'B'
            : 'A';
        }
      }

      // Reset timeout on interaction
      if (inst.assignModeTimeout) {
        clearTimeout(inst.assignModeTimeout);
      }
      inst.assignModeTimeout = setTimeout(() => {
        inst.assignModeTimeout = null;
        exitAssignMode(context);
      }, ASSIGN_MODE_TIMEOUT_MS);

      updateKnobTitle(context);
    }
    return;
  }

  // Do not change local UI state if bridge isn't LIVE (prevents misleading "ghost" moves)
  if (bridgeSafeState !== 'LIVE') {
    updateKnobTitle(context);
    return;
  }

  // XD-F005: acceleration based on rotation speed (continuous, clamped)
  // Apply movement in dB space, then convert back to fader01.
  const current01 = Math.max(0, Math.min(1, (inst.value / 100)));
  const currentDb = fader01ToDb(current01);

  // Baseline: fine control near unity, but faster travel at low levels.
  // Key stability rule: UP from -inf must be gentle; DOWN toward -inf can be aggressive.
  const dbNow = Number.isFinite(currentDb) ? currentDb : -90;

  function smoothstep01(t) {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
  }

  // Two smooth ramps based on current dB (continuous; no breakpoints in behavior).
  // t1 ramps as we drop below -20 dB; t2 ramps as we drop below -50 dB.
  const t1 = smoothstep01(((-20) - dbNow) / 30); // -20 .. -50
  const t2 = smoothstep01(((-50) - dbNow) / 40); // -50 .. -90

  // Direction-dependent baseline (dB per tick):
  //  - UP: gentle even from -inf (prevents "WHOAh" and pegging)
  //  - DOWN: aggressive (quickly reaches -inf)
  const baseStepUpDb   = 0.1 + (0.4 * t1) + (0.8 * t2); // tops out ~1.3 dB/tick
  const baseStepDownDb = 0.1 + (1.4 * t1) + (6.0 * t2); // tops out ~7.5 dB/tick

  let effectiveBaseStepDb = ticks >= 0 ? baseStepUpDb : baseStepDownDb;

  // Normalize multi-tick events so "a few clicks" behaves consistently across timing/jitter.
  const tickUnits = Math.sign(ticks) * Math.sqrt(Math.abs(ticks));

  let dbDelta = tickUnits * effectiveBaseStepDb;

  if (ENABLE_KNOB_ACCEL && ticks !== 0) {
    const now = Date.now();
    const last = inst.lastDialRotateAt || 0;
    const dtMs = Math.max(1, last > 0 ? (now - last) : 1000);

    // speed in ticks per second (more intuitive to tune)
    const tps = (Math.sqrt(Math.abs(ticks)) * 1000) / dtMs;

    // Below threshold: no accel. Above threshold: power curve.
    let gain = 1;
    if (tps > KNOB_ACCEL_THRESHOLD_TPS) {
      const over = tps - KNOB_ACCEL_THRESHOLD_TPS;
      gain = 1 + KNOB_ACCEL_K * Math.pow(over, KNOB_ACCEL_P);
    }

    if (!Number.isFinite(gain)) gain = 1;
    if (gain < 1) gain = 1;

    // Extra safety: when coming UP from very low levels, cap accel so a small twirl doesn't jump to +10.
    if (ticks > 0 && dbNow <= -60) {
      gain = Math.min(gain, 4.0);
    }

    if (gain > KNOB_ACCEL_MAX_GAIN) gain = KNOB_ACCEL_MAX_GAIN;

    dbDelta = tickUnits * effectiveBaseStepDb * gain;

    // Update timing baseline for next event
    inst.lastDialRotateAt = now;
  } else {
    // Keep timing baseline updated even when accel is off
    inst.lastDialRotateAt = Date.now();
  }

  // Compute target dB and quantize to 0.1 dB (matches X-Air Edit display granularity)
  let targetDb = (Number.isFinite(currentDb) ? currentDb : -90) + dbDelta;
  targetDb = Math.round(targetDb * 10) / 10;

  // Clamp to XR return fader display range; allow hard bottom (0.0) below -90 if stepping downward at floor.
  if (targetDb > 10) targetDb = 10;
  if (targetDb < -90) targetDb = -90;

  let target01 = dbToFader01(targetDb);

  // If we're already at -90 and moving downward, allow reaching true -inf (0.0)
  if (targetDb <= -90 && ticks < 0 && current01 <= 0.03125) {
    target01 = 0;
  }

  inst.value = Math.max(0, Math.min(100, target01 * 100));

  // Send fader move to bridge as 0.0..1.0 (protocol-style message)
  // Quantize + de-dupe to reduce jitter/noise and log spam
  const raw01 = inst.value / 100;
  const clamped01 = Math.max(0, Math.min(1, raw01));
  const value01 = Math.round(clamped01 * 1000) / 1000; // 0.001 resolution

  const nowSend = Date.now();
  const canSendByTime = (nowSend - (inst.lastSentAtMs || 0)) >= FX_FADER_SEND_MIN_INTERVAL_MS;

  if (canSendByTime && (inst.lastSentValue01 === null || Math.abs(value01 - inst.lastSentValue01) >= 0.0005)) {
    inst.lastSentAtMs = nowSend;
    inst.lastSentValue01 = value01;
    sendToBridge({
      type: "setFxFader",
      fxIndex: inst.fx,
      value: value01,
    });
  }

  updateKnobTitle(context);
}

function handleDialDown(msg) {
  const context = msg.context;
  const inst = fxInstances.get(context);
  if (!inst) return;

  // Do not change local UI state if bridge isn't LIVE
  if (bridgeSafeState !== 'LIVE') {
    updateKnobTitle(context);
    return;
  }

  // If in Assign Mode, a press acts immediately: toggle assignment (or exit) and then exit.
  if (inst.assignMode !== null) {
    if (inst.assignMode === 'EXIT') {
      // Prevent the following dialUp from being interpreted as a mute toggle.
      inst.suppressNextDialUp = true;
      exitAssignMode(context);
      return;
    }

    const busIndex = inst.assignMode === 'A' ? 1 : inst.assignMode === 'B' ? 3 : 5;
    const currentAssigned = inst.assignMode === 'A' ? inst.busA : inst.assignMode === 'B' ? inst.busB : inst.busC;
    const newAssigned = !currentAssigned;

    sendToBridge({
      type: "setFxBusAssignment",
      fxIndex: inst.fx,
      busIndex,
      assigned: newAssigned,
    });

    // Update local state immediately for responsive UI
    if (inst.assignMode === 'A') inst.busA = newAssigned;
    else if (inst.assignMode === 'B') inst.busB = newAssigned;
    else inst.busC = newAssigned;

    // Prevent the following dialUp from being interpreted as a mute toggle.
    inst.suppressNextDialUp = true;
    exitAssignMode(context);
    return;
  }

  // NORMAL mode:
  //  - single press toggles mute (delayed to allow double-press detection)
  //  - double press enters Assign Mode immediately

  inst.pressHadRotate = false;

  const now = Date.now();
  const isDouble = (now - (inst.lastDialDownAt || 0)) <= DOUBLE_PRESS_MS;
  inst.lastDialDownAt = now;

  if (isDouble) {
    // Cancel any pending mute toggle from the first press
    if (inst.pendingMuteTimer) {
      clearTimeout(inst.pendingMuteTimer);
      inst.pendingMuteTimer = null;
    }

    // Enter Assign Mode at A and start/reset timeout
    inst.assignMode = 'A';

    if (inst.assignModeTimeout) {
      clearTimeout(inst.assignModeTimeout);
    }
    inst.assignModeTimeout = setTimeout(() => {
      inst.assignModeTimeout = null;
      exitAssignMode(context);
    }, ASSIGN_MODE_TIMEOUT_MS);

    updateKnobTitle(context);
    return;
  }
}

function handleDialUp(msg) {
  const context = msg.context;
  const inst = fxInstances.get(context);
  if (!inst) return;

  // One-shot suppression: if the preceding dialDown was used for Assign Mode actions,
  // do not treat this dialUp as a mute toggle.
  if (inst.suppressNextDialUp) {
    inst.suppressNextDialUp = false;
    updateKnobTitle(context);
    return;
  }

  // Only relevant in NORMAL mode. In Assign Mode, dialDown already acted.
  if (inst.assignMode !== null) return;

  // If this press was used as a modifier for rotation (press+rotate), do not treat it as a mute toggle.
  if (inst.pressHadRotate) {
    inst.pressHadRotate = false;
    updateKnobTitle(context);
    return;
  }

  if (bridgeSafeState !== 'LIVE') {
    updateKnobTitle(context);
    return;
  }

  // Schedule mute toggle after a short delay to allow a second press to be interpreted as double-press.
  if (inst.pendingMuteTimer) {
    clearTimeout(inst.pendingMuteTimer);
    inst.pendingMuteTimer = null;
  }

  inst.pendingMuteTimer = setTimeout(() => {
    inst.pendingMuteTimer = null;

    // If assign mode started in the meantime, do not toggle mute.
    if (inst.assignMode !== null) return;

    inst.muted = !inst.muted;
    sendToBridge({
      type: "setFxMute",
      fxIndex: inst.fx,
      mute: inst.muted,
    });

    updateKnobTitle(context);
  }, MUTE_TOGGLE_DELAY_MS);

  // Update UI now (so user sees immediate feedback if desired)
  updateKnobTitle(context);
}

// Assign Mode timeout duration (5 seconds)
const ASSIGN_MODE_TIMEOUT_MS = 5000;

// Gesture timing
const DOUBLE_PRESS_MS = 350;      // two dialDown events within this window enter Assign Mode
const MUTE_TOGGLE_DELAY_MS = 200; // delay mute toggle to allow double-press detection

// Knob acceleration (XD-F005) — FX faders only
const ENABLE_KNOB_ACCEL = true;
const KNOB_ACCEL_BASE_STEP = 0.5;   // (legacy; dB-domain uses its own baseStepDb)
const KNOB_ACCEL_THRESHOLD_TPS = 4; // below this speed (ticks/sec), no accel
const KNOB_ACCEL_MAX_GAIN = 16.0;   // higher cap so fast spins can "slam" across range
const KNOB_ACCEL_K = 0.03;          // stronger acceleration
const KNOB_ACCEL_P = 1.5;           // slightly steeper curve

// Limit outbound fader writes to avoid bursty traffic (still updates UI locally every tick)
const FX_FADER_SEND_MIN_INTERVAL_MS = 33; // ~30 Hz

function exitAssignMode(context) {
  const inst = fxInstances.get(context);
  if (!inst) return;

  if (inst.assignModeTimeout) {
    clearTimeout(inst.assignModeTimeout);
    inst.assignModeTimeout = null;
  }

  inst.assignMode = null;
  updateKnobTitle(context);
}

function cycleAssignMode(context) {
  const inst = fxInstances.get(context);
  if (!inst) return;

  // Clear existing timeout
  if (inst.assignModeTimeout) {
    clearTimeout(inst.assignModeTimeout);
  }

  // Cycle: A → B → C → EXIT → NORMAL
  if (inst.assignMode === null) {
    inst.assignMode = 'A';
  } else if (inst.assignMode === 'A') {
    inst.assignMode = 'B';
  } else if (inst.assignMode === 'B') {
    inst.assignMode = 'C';
  } else if (inst.assignMode === 'C') {
    inst.assignMode = 'EXIT';
  } else if (inst.assignMode === 'EXIT') {
    exitAssignMode(context);
    return;
  }

  // Set timeout to auto-exit
  inst.assignModeTimeout = setTimeout(() => {
    inst.assignModeTimeout = null;
    exitAssignMode(context);
  }, ASSIGN_MODE_TIMEOUT_MS);

  updateKnobTitle(context);
}

function handleFxKeyDown(msg) {
  const context = msg.context;
  const inst = fxInstances.get(context);
  if (!inst) {
    logViaBridge('handleFxKeyDown_no_instance', { context });
    return;
  }

  // Auto-exit assign mode if bridge is not LIVE
  if (bridgeSafeState !== 'LIVE') {
    if (inst.assignMode !== null) {
      exitAssignMode(context);
    }
    return;
  }

  // Screen tap cycles through assign mode states
  logViaBridge('handleFxKeyDown_calling_cycle', { context, currentMode: inst.assignMode });
  cycleAssignMode(context);
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
    signalPresent: false, // true when signal exceeds noise floor threshold
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
  // Do not toggle local state if bridge isn't LIVE
  if (bridgeSafeState !== 'LIVE') {
    updateChannelTitle(context);
    return;
  }

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
      signalPresent: false,
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

function squareMeter(level, width = 8, signalPresent = false) {
  // Clamp level to [0,1]
  if (level < 0) level = 0;
  if (level > 1) level = 1;
  const filled = Math.round(level * width);
  const empty = Math.max(0, width - filled);
  const fullChar = ":";
  const emptyChar = ".";
  let meterBar = fullChar.repeat(filled) + emptyChar.repeat(empty);
  // Signal-present indicator: replace first "." with "•" when signal exceeds noise floor
  if (signalPresent && empty > 0) {
    meterBar = fullChar.repeat(filled) + "\u2022" + emptyChar.repeat(empty - 1);
  }
  return meterBar;
}

// Convert normalized fader value (0.0..1.0) to XR/X32-style dB display (-∞ .. +10 dB).
// Based on documented 4 linear dB regions and common anchor points used by X-Air/X32 UIs.
function fader01ToDb(val01) {
  const x = Math.max(0, Math.min(1, Number(val01)));
  if (!Number.isFinite(x) || x <= 0) return -Infinity;

  // Anchor points (normalized -> dB)
  // 0.03125 (-90), 0.0625 (-60), 0.25 (-30), 0.5 (-10), 0.75 (0), 1.0 (+10)
  const pts = [
    { x: 0.03125, db: -90 },
    { x: 0.0625,  db: -60 },
    { x: 0.25,    db: -30 },
    { x: 0.5,     db: -10 },
    { x: 0.75,    db: 0 },
    { x: 1.0,     db: 10 },
  ];

  // Below first anchor but above 0: clamp to -90 dB (matches X-Air/X32 UI behavior better than drifting below).
  if (x < pts[0].x) {
    return -90;
  }

  // Piecewise linear interpolation between anchors.
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (x <= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      return a.db + t * (b.db - a.db);
    }
  }

  return 10;
}

// Convert XR/X32-style dB value (-90 .. +10) back to normalized fader (0.0..1.0)
// using the inverse of the piecewise anchor mapping used in fader01ToDb().
function dbToFader01(db) {
  const d = Number(db);
  if (!Number.isFinite(d)) return 0;

  // Clamp to our supported range.
  if (d <= -90) return 0.03125;
  if (d >= 10) return 1.0;

  // Anchor points (dB -> normalized)
  const pts = [
    { db: -90, x: 0.03125 },
    { db: -60, x: 0.0625 },
    { db: -30, x: 0.25 },
    { db: -10, x: 0.5 },
    { db: 0,   x: 0.75 },
    { db: 10,  x: 1.0 },
  ];

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (d <= b.db) {
      const t = (d - a.db) / (b.db - a.db);
      const x = a.x + t * (b.x - a.x);
      return Math.max(0, Math.min(1, x));
    }
  }

  return 1.0;
}

function updateKnobTitle(context) {
  if (!sdSocket) return;
  const inst = fxInstances.get(context);
  if (!inst) return;

  // Map 0..100 to 0.0..1.0
  const val01 = inst.value / 100;
  const meter01 = typeof inst.meter === "number" ? inst.meter : 0;

  // XR/X32-style dB readout (-∞ .. +10) using piecewise mapping
  const db = fader01ToDb(val01);
  // Avoid "-0.0" display caused by floating point jitter around zero.
  const dbDisplay = (Number.isFinite(db) && Math.abs(db) < 0.05) ? 0 : db;

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

  // Live meter bar: ####.... (with signal-present indicator if applicable)
  const signalPresent = typeof inst.signalPresent === "boolean" ? inst.signalPresent : false;
  const meterBar = squareMeter(meter01, WIDTH_METER, signalPresent);

  // Build four lines:
  //  1: channel name (or assign mode prompt)
  //  2: status/value (dB, MUTE, OFFLINE, STALE) + bus letters
  //  3: fader bar
  //  4: live meter bar
  const isOffline = (!bridgeOnline || bridgeSafeState === 'OFFLINE');
  const isStale = (!isOffline && bridgeSafeState === 'STALE');

  // Helper: format bus letters (A, B, C) for assigned buses
  function formatBusLetters() {
    const buses = [];
    if (inst.busA) buses.push('A');
    if (inst.busB) buses.push('B');
    if (inst.busC) buses.push('C');
    return buses.length > 0 ? ' ' + buses.join('') : '';
  }

  // Line 2: Status/value + bus letters
  let statusLine;
  if (isOffline) {
    statusLine = "OFFLINE";
  } else if (isStale) {
    statusLine = "STALE";
  } else if (inst.muted) {
    statusLine = "MUTE" + formatBusLetters();
  } else {
    if (!Number.isFinite(dbDisplay) || dbDisplay <= -120) {
      // Use explicit Unicode escapes for minus and infinity
      statusLine = `\u2212\u221E dB` + formatBusLetters();
    } else {
      statusLine = `${dbDisplay.toFixed(1)} dB` + formatBusLetters();
    }
  }

  // Line 1: Channel name or Assign Mode label
  let nameLine;
  if (inst.assignMode !== null) {
    if (inst.assignMode === 'A') nameLine = inst.busAName || 'BUS 2';
    else if (inst.assignMode === 'B') nameLine = inst.busBName || 'BUS 4';
    else if (inst.assignMode === 'C') nameLine = inst.busCName || 'BUS 6';
    else nameLine = 'EXIT';
  } else {
    // Normal mode: channel name
    nameLine = isOffline
      ? "--"
      : (inst.name || `FX${inst.fx}`);
  }

  const line1 = `${padLeftStr}${nameLine}${padRightStr}`;
  const line2 = `${padLeftStr}${statusLine}${padRightStr}`;
  const line3 = `${padLeftStr}${faderBar}${padRightStr}`;
  const line4 = `${padLeftStr}${meterBar}${padRightStr}`;

  const title = `${line1}\n${line2}\n${line3}\n${line4}`;

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

function setState(context, state) {
  if (!sdSocket) return;
  const payload = {
    event: "setState",
    context,
    payload: {
      state,
    },
  };
  sdSocket.send(JSON.stringify(payload));
}

function updateChannelTitle(context) {
  if (!sdSocket) return;
  const inst = channelInstances.get(context);
  if (!inst) return;
  const isOffline = (!bridgeOnline || bridgeSafeState === 'OFFLINE');
  const isStale = (!isOffline && bridgeSafeState === 'STALE');

  const nameCore = isOffline
    ? "--"
    : (inst.name || `${inst.targetType.toUpperCase()}${String(inst.targetIndex).padStart(2, "0")}`);

  const isOnAir = !isOffline && !inst.muted;
  const statusLine = isOffline
    ? "OFFLINE"
    : (isStale ? "STALE" : (isOnAir ? "ON" : "OFF"));

  const stateIndex = isOnAir ? 1 : 0;

  const meter01 = typeof inst.meter === "number" ? inst.meter : 0;
  const signalPresent = typeof inst.signalPresent === "boolean" ? inst.signalPresent : false;
  const meterBar = squareMeter(meter01, 16, signalPresent);

  const line1 = nameCore;
  const line2 = statusLine;
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

  // Swap visual state based on on-air status (state 0 = OFF/blank, state 1 = ON/green glow).
  setState(context, stateIndex);
}

function sendToBridge(msg) {
  if (DEBUG_BRIDGE_SEND) {
    console.log('XR18FX: sendToBridge', msg, 'readyState=', bridgeSocket && bridgeSocket.readyState);
  }
  logViaBridge('sendToBridge', msg);
  if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) return;

  const isControlWrite = (
    msg && typeof msg === 'object' && (
      msg.type === 'setFxFader' ||
      msg.type === 'setFxMute' ||
      msg.type === 'setFxBusAssignment' ||
      msg.type === 'setChannelFader' ||
      msg.type === 'setChannelMute' ||
      msg.type === 'channelToggleMute'
    )
  );

  if (isControlWrite && bridgeSafeState !== 'LIVE') {
    console.log('XR18FX: blocked control write while', bridgeSafeState, msg.type);
    return;
  }

  try {
    bridgeSocket.send(JSON.stringify(msg));
  } catch (e) {
    // ignore
  }
}
