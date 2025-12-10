// xr18channel.js
// XR18 "Channel Button" action: mono strip with ON/OFF + meter, no fader control.

let sdSocket = null;
let pluginUUID = null;
const channelInstances = new Map(); // context -> instance state

let bridgeSocket = null;
let bridgeConnected = false;

function log(...args) {
  // Comment out to silence debug
  // eslint-disable-next-line no-console
  console.log('[XR18-CHANNEL]', ...args);
}

// ---- Stream Dock wiring ----------------------------------------------------

function connectElgatoStreamDeckSocket(port, inPluginUUID, registerEvent, inInfo) {
  pluginUUID = inPluginUUID;

  sdSocket = new WebSocket('ws://127.0.0.1:' + port);

  sdSocket.onopen = function () {
    const reg = {
      event: registerEvent,
      uuid: pluginUUID,
    };
    sdSocket.send(JSON.stringify(reg));
    log('SD socket open');
    connectBridge();
  };

  sdSocket.onmessage = function (evt) {
    try {
      const msg = JSON.parse(evt.data);
      handleSdMessage(msg);
    } catch (err) {
      log('SD onmessage error', err);
    }
  };

  sdSocket.onclose = function () {
    log('SD socket closed');
  };

  sdSocket.onerror = function (err) {
    log('SD socket error', err);
  };
}

function sendToSd(msg) {
  if (!sdSocket || sdSocket.readyState !== WebSocket.OPEN) return;
  sdSocket.send(JSON.stringify(msg));
}

function setTitle(context, title) {
  sendToSd({
    event: 'setTitle',
    context,
    payload: {
      title,
      target: 0,
    },
  });
}

function setState(context, state) {
  sendToSd({
    event: 'setState',
    context,
    payload: {
      state,
    },
  });
}

// ---- Bridge wiring ---------------------------------------------------------

function connectBridge() {
  if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) return;
  try {
    bridgeSocket = new WebSocket('ws://127.0.0.1:18018');
  } catch (err) {
    log('Bridge connect error', err);
    return;
  }

  bridgeSocket.onopen = function () {
    bridgeConnected = true;
    log('Bridge connected');
    // Identify as a channel-button client
    sendBridge({
      type: 'hello',
      role: 'channelButton',
    });
    // Register all current instances so bridge can sync them
    for (const inst of channelInstances.values()) {
      registerInstanceWithBridge(inst);
    }
  };

  bridgeSocket.onclose = function () {
    bridgeConnected = false;
    log('Bridge closed');
  };

  bridgeSocket.onerror = function (err) {
    log('Bridge error', err);
  };

  bridgeSocket.onmessage = function (evt) {
    try {
      const msg = JSON.parse(evt.data);
      handleBridgeMessage(msg);
    } catch (err) {
      log('Bridge onmessage error', err);
    }
  };
}

function sendBridge(obj) {
  if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) return;
  bridgeSocket.send(JSON.stringify(obj));
}

// ---- Instance management ----------------------------------------------------

function makeDefaultInstance(context, payload) {
  const settings = (payload && payload.settings) || {};

  // Configurable target; defaults to input 1
  const targetType = settings.targetType || 'ch'; // 'ch', 'rtn', 'bus', 'main'
  const rawIndex = parseInt(settings.targetIndex, 10);
  const targetIndex = Number.isFinite(rawIndex) && rawIndex > 0 ? rawIndex : 1;

  return {
    context,
    targetType,   // how we address it on XR18
    targetIndex,  // 1-based index (e.g. ch05 = 5)
    name: '',     // from mixer, or fallback below
    muted: false, // true = OFF
    meter: 0,     // 0.0..1.0
  };
}

function registerInstanceWithBridge(inst) {
  if (!bridgeConnected) return;
  sendBridge({
    type: 'channelRegister',
    targetType: inst.targetType,
    targetIndex: inst.targetIndex,
  });
}

// ---- SD event handling ------------------------------------------------------

function handleSdMessage(msg) {
  const event = msg.event;
  if (event === 'willAppear') {
    handleWillAppear(msg);
  } else if (event === 'willDisappear') {
    handleWillDisappear(msg);
  } else if (event === 'keyDown') {
    handleKeyDown(msg);
  } else if (event === 'keyUp') {
    // no-op for now
  } else if (event === 'sendToPlugin') {
    // future: settings panel messages if needed
  }
}

function handleWillAppear(msg) {
  const context = msg.context;
  const payload = msg.payload || {};
  const inst = makeDefaultInstance(context, payload);
  channelInstances.set(context, inst);

  // Provisional name if mixer hasn't sent one yet
  if (!inst.name) {
    const idx = String(inst.targetIndex).padStart(2, '0');
    inst.name = `${inst.targetType.toUpperCase()}${idx}`;
  }

  registerInstanceWithBridge(inst);
  updateChannelTitle(context);
}

function handleWillDisappear(msg) {
  const context = msg.context;
  channelInstances.delete(context);
}

function handleKeyDown(msg) {
  const context = msg.context;
  const inst = channelInstances.get(context);
  if (!inst) return;

  // Tap toggles mute on the target channel
  sendBridge({
    type: 'channelToggleMute',
    targetType: inst.targetType,
    targetIndex: inst.targetIndex,
  });
}

// ---- Bridge message handling ------------------------------------------------

function handleBridgeMessage(msg) {
  // Expect messages like:
  //  { type: "channelState",
  //    targetType: "ch", targetIndex: 5,
  //    muted: true/false,
  //    meter: 0..1,
  //    name: "Desk Mic" }
  if (msg.type === 'channelState') {
    const { targetType, targetIndex } = msg;
    for (const [context, inst] of channelInstances.entries()) {
      if (inst.targetType === targetType && inst.targetIndex === targetIndex) {
        if (typeof msg.muted === 'boolean') {
          inst.muted = msg.muted;
        }
        if (typeof msg.meter === 'number') {
          let m = msg.meter;
          if (m < 0) m = 0;
          if (m > 1) m = 1;
          inst.meter = m;
        }
        if (typeof msg.name === 'string' && msg.name.trim().length > 0) {
          inst.name = msg.name.trim();
        }
        updateChannelTitle(context);
      }
    }
  }
}

// ---- Rendering --------------------------------------------------------------

function squareMeter(level, width = 16) {
  if (level < 0) level = 0;
  if (level > 1) level = 1;
  const filled = Math.round(level * width);
  const empty = Math.max(0, width - filled);

  // Dotty style: ":" = signal, "." = empty
  const fullChar = ':';
  const emptyChar = '.';
  return fullChar.repeat(filled) + emptyChar.repeat(empty);
}

function updateChannelTitle(context) {
  const inst = channelInstances.get(context);
  if (!inst) return;

  const nameCore = inst.name || `${inst.targetType.toUpperCase()}${String(inst.targetIndex).padStart(2, '0')}`;
  const statusCore = inst.muted ? 'OFF' : 'ON';
  const isOnAir = !inst.muted;
  const stateIndex = isOnAir ? 1 : 0;
  const statusLine = isOnAir ? 'ON  LIVE' : 'OFF SAFE';
  const meterBar = squareMeter(inst.meter, 16);

  const line1 = nameCore;
  const line2 = statusLine;
  const line3 = meterBar;

  const title = `${line1}\n${line2}\n${line3}`;
  setTitle(context, title);

  // Swap visual state based on on-air status (state 0 = OFF/blank, state 1 = ON/green glow).
  setState(context, stateIndex);
}
