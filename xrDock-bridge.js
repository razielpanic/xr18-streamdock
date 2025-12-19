// xr18fx-bridge.js
// WebSocket <-> XR18 bridge using ONE UDP socket + minimal OSC encoder/decoder
//
// Requirements in this plugin folder:
//   npm install ws
//
// Behavior:
//   - Listens for WebSocket messages from the plugin (fader/mute commands)
//   - Sends OSC to the XR18 FX returns: /rtn/N/mix/fader, /rtn/N/mix/on
//   - Uses ONE UDP socket (dgram) for both send and receive
//   - Polls XR18 every second for fader + mute state of FX1..4
//   - For every OSC reply, broadcasts state back to all plugin instances
//
// Run with (from plugin folder):
//   cd /Users/razielpanic/Library/Application Support/HotSpot/StreamDock/plugins/com.youshriek.xr18fx.sdPlugin
//   node xr18fx-bridge.js
//


const dgram = require('dgram');
const WebSocket = require('ws');

// Optional shared WebSocket protocol definitions (if present)
let wsProtocol = {};
try {
  wsProtocol = require('./wsProtocol');
} catch (err) {
  console.warn('wsProtocol.js not found; using legacy WebSocket message shapes');
}
const {
  MSG_HELLO,
  MSG_WELCOME,
  MSG_REQUEST_FULL_STATE,
  MSG_SET_FX_FADER,
  MSG_SET_FX_MUTE,
  MSG_SET_FX_BUS_ASSIGNMENT,
  MSG_SET_CHANNEL_FADER,
  MSG_SET_CHANNEL_MUTE,
  MSG_FX_STATE,
  MSG_CHANNEL_STATE,
  MSG_METERS_FRAME,
  MSG_CONNECTION_STATE,
  MSG_ERROR,
  parseMessage,
} = wsProtocol;

// Debug flags (edit these booleans directly while developing)
const DEBUG_OSC        = false; // logs raw OSC packets from XR18
const DEBUG_WS         = false; // logs decoded WS objects (in addition to JSON line logs)
// Logs every OSC control write we send to the XR18 (very noisy during knob moves)
const DEBUG_OSC_SEND   = false;

// JSON traffic bridge <-> plugin (high volume). Keep enabled but filtered by default.
// Turn this off if the console is too noisy.
const DEBUG_JSON       = false;

// Per-meter detailed logging (very high volume). Enable only when debugging meters.
const DEBUG_METERS     = false;

// Forwarded plugin {type:"log"} messages. Enable when you want to see input events (keyDown/dialDown).
const DEBUG_PLUGIN_LOG = false;

// ---- T009: Connection / Safe-State (OFFLINE | STALE | LIVE) ----

const SAFE_OFFLINE = 'OFFLINE';
const SAFE_STALE   = 'STALE';
const SAFE_LIVE    = 'LIVE';

// Tunables (ms)
const OSC_OFFLINE_MS = 4000;   // no OSC packets => OFFLINE
const OSC_LIVE_MS    = 1500;   // OSC seen recently => candidate for LIVE/STALE
const METERS_LIVE_MS = 1500;   // meters seen recently => LIVE

let lastOscRxAt = 0;
let lastMetersRxAt = 0;
let lastSafeState = SAFE_OFFLINE;

// One-shot recovery attempt per STALE episode (XD-B002 minimal)
let staleRecoveryAttempted = false;
let staleRecoveryTimer = null;

function computeSafeState(now) {
  const oscAge = lastOscRxAt ? (now - lastOscRxAt) : Infinity;
  const metersAge = lastMetersRxAt ? (now - lastMetersRxAt) : Infinity;

  if (oscAge >= OSC_OFFLINE_MS) return SAFE_OFFLINE;
  if (oscAge <= OSC_LIVE_MS && metersAge <= METERS_LIVE_MS) return SAFE_LIVE;
  return SAFE_STALE;
}

function broadcastConnectionState(state) {
  const payload = JSON.stringify({
    type: MSG_CONNECTION_STATE || 'connectionState',
    state,
    lastOscRxAt,
    lastMetersRxAt,
  });

  logBridgeToPlugin(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function updateAndBroadcastSafeState(now) {
  const next = computeSafeState(now);
  if (next !== lastSafeState) {
    lastSafeState = next;
    broadcastConnectionState(next);

    // XD-B002 minimal: attempt a single recovery when entering STALE.
    if (next === SAFE_STALE) {
      scheduleStaleRecoveryOnce();
    } else {
      // Any transition to LIVE/OFFLINE resets the per-episode guard.
      resetStaleRecoveryState();
    }
  }
}

function scheduleStaleRecoveryOnce() {
  if (staleRecoveryAttempted) return;
  staleRecoveryAttempted = true;

  // Small delay so we don't fire in the middle of a transient gap
  if (staleRecoveryTimer) {
    clearTimeout(staleRecoveryTimer);
    staleRecoveryTimer = null;
  }

  staleRecoveryTimer = setTimeout(() => {
    staleRecoveryTimer = null;

    // Only attempt if we are still STALE (not OFFLINE, not already LIVE)
    if (lastSafeState !== SAFE_STALE) return;

    console.log('[B002] STALE detected: one-shot recovery (reassert /xremotenfb + renew meters/1)');

    try {
      // Reassert remote session + renew meters subscription
      sendOscQuery('/xremotenfb');
      subscribeMeters();
      pollMeters();
    } catch (e) {
      // Never throw from recovery path
      console.warn('[B002] Recovery attempt failed:', e && e.message ? e.message : e);
    }
  }, 250);
}

function resetStaleRecoveryState() {
  staleRecoveryAttempted = false;
  if (staleRecoveryTimer) {
    clearTimeout(staleRecoveryTimer);
    staleRecoveryTimer = null;
  }
}

function maySendControl() {
  // Conservative: only allow control writes when fully LIVE.
  // This prevents “blind writes” when the bridge is STALE/OFFLINE.
  return lastSafeState === SAFE_LIVE;
}

// Recompute state on a steady cadence so UI flips to OFFLINE/STALE even if packets stop.
setInterval(() => updateAndBroadcastSafeState(Date.now()), 250);

// JSON flow logging helpers (plugin <-> bridge)
// Filter high-frequency meter frames and forwarded plugin logs so the console remains usable.
function shouldLogJson(raw, direction) {
  if (!DEBUG_JSON) return false;

  // Fast path: drop obvious meter updates without parsing.
  // These dominate output under normal operation.
  if (raw && typeof raw === 'string') {
    // Bridge -> plugin fxState meter frames
    if (raw.includes('"type":"fxState"') && raw.includes('"meter"')) {
      return false;
    }
    // Any explicit metersFrame message types (if used)
    if (raw.includes('"type":"metersFrame"') || raw.includes('"type":"meter"')) {
      return false;
    }
  }

  // Try to parse for more precise filtering (never throw)
  try {
    const msg = JSON.parse(raw);
    if (!msg || typeof msg !== 'object') return true;

    // Suppress forwarded plugin log spam unless explicitly enabled
    if (direction === 'PLUGIN' && msg.type === 'log' && !DEBUG_PLUGIN_LOG) {
      return false;
    }

    // Also suppress bridge->plugin connectionState payload repeats are already edge-triggered,
    // so we keep them visible.

    return true;
  } catch {
    // If it isn't JSON, log it (rare)
    return true;
  }
}

function logPluginToBridge(raw) {
  if (!shouldLogJson(raw, 'PLUGIN')) return;
  console.log('[PLUGIN → BRIDGE]', raw);
}

function logBridgeToPlugin(raw) {
  if (!shouldLogJson(raw, 'BRIDGE')) return;
  console.log('[BRIDGE → PLUGIN]', raw);
}

// XR18 network settings
const XR18_IP   = '192.168.1.37';
const XR18_PORT = 10024;

// Local UDP port for our OSC socket (send + receive on this port)
const LOCAL_OSC_PORT = 62058;

// WebSocket port between plugin and bridge
const BRIDGE_PORT = 18018;

// ---- Meter conversion helpers (used by /meters/1 decoding) ----
// XR18 meter samples appear to be signed 16-bit values in 1/256 dB units.
function rawToDb(raw) {
  return raw / 256.0;
}

function dbToLevel(db, floorDb) {
  if (db <= floorDb) return 0;
  if (db >= 0) return 1;
  return (db - floorDb) / -floorDb;
}

// Separate floors for FX tiles vs Channel Button key:
//  - FX meters: keep a deep floor so you can see more low-level ambience.
//  - Channel Button meter: raise floor so noise floor doesn't animate.
const FX_METER_FLOOR_DB = -60;
const KEY_METER_FLOOR_DB = -60;

// Signal-present threshold: detect signal above noise floor even when below visual threshold
// Must be below both FX and channel visual floors to be useful
const SIGNAL_PRESENT_THRESHOLD_DB = -80;

// Create single UDP socket
const udp = dgram.createSocket('udp4');

// WebSocket server for plugin connections
const wss = new WebSocket.Server({ port: BRIDGE_PORT });

// Helper: OSC address for XR18 FX return N (1..4)
function fxPath(fx, suffix) {
  // XR18 FX returns: /rtn/1..4/mix/...
  return `/rtn/${fx}/${suffix}`;
}

// Zero-pad channel indices to 2 digits (e.g. 1 -> "01")
function pad2(n) {
  return String(n).padStart(2, '0');
}

// Registered channel button targets (for Channel Button action)
// Each entry: { targetType: "ch", targetIndex: 1, muted?: bool, name?: string }
const channelTargets = [];

// Mixbus display names (your convention stores stereo-pair names on the 2nd bus of each pair)
// We read /bus/2,/bus/4,/bus/6 config names and forward them to FX tiles as busAName/busBName/busCName.
const busNames = {
  2: 'BUS 2',
  4: 'BUS 4',
  6: 'BUS 6',
};

function broadcastBusNamesToAllFx() {
  for (let fx = 1; fx <= 4; fx++) {
    broadcastState({
      fx,
      kind: 'busNames',
      busAName: busNames[2],
      busBName: busNames[4],
      busCName: busNames[6],
    });
  }
}

// ---- Minimal OSC helpers ----

// Pad length to next multiple of 4
function pad4(len) {
  const r = len % 4;
  return r === 0 ? 0 : 4 - r;
}

// Build an OSC string (null-terminated, 4-byte aligned)
function oscString(str) {
  const s = Buffer.from(str, 'ascii');
  const len = s.length + 1; // include null
  const pad = pad4(len);
  const buf = Buffer.alloc(len + pad);
  s.copy(buf, 0);
  // buf is already zero-filled by Buffer.alloc
  return buf;
}

// Encode a single OSC message with given address, types, and values
// types: e.g. "" (no args), "f", "i", etc. (do not include leading comma)
function encodeOscMessage(address, types, values) {
  if (!types) types = '';
  const addrBuf = oscString(address);
  const typeTag = ',' + types;
  const tagBuf = oscString(typeTag);

  const argBufs = [];
  if (types.length && Array.isArray(values)) {
    for (let i = 0; i < types.length; i++) {
      const t = types[i];
      const v = values[i];
      if (t === 'f') {
        const b = Buffer.alloc(4);
        b.writeFloatBE(Number(v) || 0, 0);
        argBufs.push(b);
      } else if (t === 'i') {
        const b = Buffer.alloc(4);
        b.writeInt32BE(Number(v) || 0, 0);
        argBufs.push(b);
      } else if (t === 's') {
        // OSC string argument: null-terminated, 4-byte aligned
        argBufs.push(oscString(String(v)));
      } else {
        // Unknown type: skip or pad 4 bytes
        const b = Buffer.alloc(4);
        argBufs.push(b);
      }
    }
  }

  return Buffer.concat([addrBuf, tagBuf, ...argBufs]);
}

// Decode a single OSC message (no bundles) into { address, args: [{type,value}, ...] }
function decodeOscMessage(buf) {
  let offset = 0;

  function readString() {
    let end = offset;
    while (end < buf.length && buf[end] !== 0) end++;
    const str = buf.slice(offset, end).toString('ascii');
    end++; // skip null
    while (end % 4 !== 0) end++;
    offset = end;
    return str;
  }

  if (buf.length < 4) return null;

  const address = readString();
  // Accept XR18 meter packets even though they use addresses like "meters/0"
  // without a leading slash.
  if (!address) return null;
  if (offset >= buf.length) {
    return { address, args: [] };
  }

  const typeTag = readString(); // e.g. ",f" or "," or ",i"
  if (!typeTag || typeTag[0] !== ',') {
    return { address, args: [] };
  }
  const types = typeTag.slice(1); // drop leading comma

  const args = [];
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    if (t === 'f') {
      if (offset + 4 > buf.length) break;
      const v = buf.readFloatBE(offset);
      offset += 4;
      args.push({ type: 'f', value: v });
    } else if (t === 'i') {
      if (offset + 4 > buf.length) break;
      const v = buf.readInt32BE(offset);
      offset += 4;
      args.push({ type: 'i', value: v });
    } else if (t === 's') {
      // OSC string argument: null-terminated, 4-byte aligned
      let end = offset;
      while (end < buf.length && buf[end] !== 0) end++;
      const str = buf.slice(offset, end).toString('ascii');
      end++; // skip null
      while (end % 4 !== 0) end++;
      offset = end;
      args.push({ type: 's', value: str });
    } else if (t === 'b') {
      // OSC blob: 32-bit size followed by that many bytes, 4-byte padded
      if (offset + 4 > buf.length) break;
      const blobSize = buf.readInt32BE(offset);
      offset += 4;
      if (blobSize < 0 || offset + blobSize > buf.length) break;
      const blob = buf.slice(offset, offset + blobSize);
      offset += blobSize;
      while (offset % 4 !== 0) offset++;
      args.push({ type: 'b', value: blob });
    } else {
      // skip unknown type as 4-byte chunk
      if (offset + 4 > buf.length) break;
      offset += 4;
    }
  }

  return { address, args };
}

// Helper: send OSC with no arguments (query)
function sendOscQuery(address) {
  const buf = encodeOscMessage(address, '', []);
  udp.send(buf, 0, buf.length, XR18_PORT, XR18_IP);
}

// Helper: send OSC with a single float argument
function sendOscFloat(address, value) {
  const buf = encodeOscMessage(address, 'f', [value]);
  udp.send(buf, 0, buf.length, XR18_PORT, XR18_IP);
}

// Helper: send OSC with a single int argument
function sendOscInt(address, value) {
  const buf = encodeOscMessage(address, 'i', [value]);
  udp.send(buf, 0, buf.length, XR18_PORT, XR18_IP);
}

// ---- Bridge logic ----

// Broadcast FX state back to all connected plugin clients (protocol-style)
function broadcastState(state) {
  // Protocol-style FX state message. We send partial updates: only the field that changed.
  const msg = {
    type: MSG_FX_STATE || 'fxState',
    fxIndex: state.fx,
  };

  if (state.kind === 'fader' && typeof state.value === 'number') {
    msg.fader = state.value;        // 0.0..1.0
  }
  if (state.kind === 'mute' && typeof state.muted === 'boolean') {
    msg.mute = state.muted;         // boolean
  }
  if (state.kind === 'name' && typeof state.name === 'string') {
    msg.name = state.name;          // string
  }
  if (state.kind === 'meter') {
    // Meters may be passed as state.meter or state.value; accept either.
    const meter = typeof state.meter === 'number' ? state.meter : state.value;
    if (typeof meter === 'number') {
      msg.meter = meter;            // 0.0..1.0
    }
    // Signal-present indicator: only include if explicitly provided and valid
    // Defaults to false if missing/invalid (stale/unknown/degraded state)
    if (typeof state.signalPresent === 'boolean') {
      msg.signalPresent = state.signalPresent;
    } else {
      msg.signalPresent = false;
    }
  }
  if (state.kind === 'busA' && typeof state.busA === 'boolean') {
    msg.busA = state.busA;
  }
  if (state.kind === 'busB' && typeof state.busB === 'boolean') {
    msg.busB = state.busB;
  }
  if (state.kind === 'busC' && typeof state.busC === 'boolean') {
    msg.busC = state.busC;
  }

  // Optional paired-bus display names (Bus 2/4/6)
  if (typeof state.busAName === 'string') {
    msg.busAName = state.busAName;
  }
  if (typeof state.busBName === 'string') {
    msg.busBName = state.busBName;
  }
  if (typeof state.busCName === 'string') {
    msg.busCName = state.busCName;
  }

  const json = JSON.stringify(msg);
  logBridgeToPlugin(json);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  });
}

// Broadcast a generic channel-state update for Channel Button clients
function broadcastChannelState(state) {
  const msg = {
    type: MSG_CHANNEL_STATE || 'channelState',
    targetType: state.targetType,
    targetIndex: state.targetIndex,
  };

  // Include optional fields only if present
  if (typeof state.muted === 'boolean') {
    msg.muted = state.muted;
  }
  if (typeof state.meter === 'number') {
    msg.meter = state.meter;
  }
  if (typeof state.name === 'string') {
    msg.name = state.name;
  }
  // Signal-present indicator: only include when explicitly provided (meter updates)
  // Do not include for name/mute updates to avoid overwriting previous signalPresent value
  if (typeof state.signalPresent === 'boolean') {
    msg.signalPresent = state.signalPresent;
  }

  const payload = JSON.stringify(msg);
  logBridgeToPlugin(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Poll a single FX return for its current fader, mute, and bus assignment state
function pollFx(fx) {
  // Query current value by sending address with no arguments
  sendOscQuery(fxPath(fx, 'mix/fader'));
  sendOscQuery(fxPath(fx, 'mix/on'));
  sendOscQuery(`/rtn/${fx}/config/name`);
  // Query bus assignments (A=01, B=03, C=05)
  sendOscQuery(`/rtn/${fx}/mix/01/grpon`);
  sendOscQuery(`/rtn/${fx}/mix/03/grpon`);
  sendOscQuery(`/rtn/${fx}/mix/05/grpon`);
}

// Poll all four FX returns
function pollAllFx() {
  [1, 2, 3, 4].forEach(pollFx);
}

// Poll mixbus display names used for FX Assign Mode labels (Bus 2/4/6)
function pollBusNames() {
  sendOscQuery('/bus/2/config/name');
  sendOscQuery('/bus/4/config/name');
  sendOscQuery('/bus/6/config/name');
}

// Poll all registered channel button targets for mute + name
function pollChannelTargets() {
  channelTargets.forEach((t) => {
    if (t.targetType !== 'ch') return;
    const idx = t.targetIndex;
    if (!Number.isFinite(idx) || idx < 1) return;
    const chId = pad2(idx);
    sendOscQuery(`/ch/${chId}/mix/on`);
    sendOscQuery(`/ch/${chId}/config/name`);
  });
}

// Send /renew "meters/N" to subscribe/refresh meter blocks
function sendOscRenewMeters(set) {
  const addrBuf = oscString('/renew');
  const tagBuf = oscString(',s');

  // Some docs show "meters/1", others "/meters/1" as the string.
  // Send both variants to be robust.
  const arg1 = oscString(`meters/${set}`);   // without leading slash
  const arg2 = oscString(`/meters/${set}`);  // with leading slash

  const buf1 = Buffer.concat([addrBuf, tagBuf, arg1]);
  const buf2 = Buffer.concat([addrBuf, tagBuf, arg2]);

  udp.send(buf1, 0, buf1.length, XR18_PORT, XR18_IP);
  udp.send(buf2, 0, buf2.length, XR18_PORT, XR18_IP);
}

// Renew meter subscriptions; we only need /meters/1 for FX1–4 returns
function pollMeters() {
  const blocks = [1];
  for (const set of blocks) {
    sendOscRenewMeters(set);
  }
}

//
// SUBSCRIBE TO METERS
// X-Air will only send /meters/N blobs to the port that requests them.
//

function subscribeMeters() {
  // Initial subscription: /meters with args ("/meters/1", 40)
  //  - "/meters/1" is the block that contains ch1–16, Aux L/R, FX1–4 returns, buses, etc.
  //  - 40 = number of 16-bit values we expect for this block.
  const subBuf = encodeOscMessage('/meters', 'si', ['/meters/1', 40]);
  udp.send(subBuf, 0, subBuf.length, XR18_PORT, XR18_IP);

  // Ongoing renewals are handled by pollMeters() via /renew "meters/N"
  pollMeters();
}

// ---- T002: Meter blob decoding (hardened) ----
// XR18 meters payload is a blob whose first 4 bytes are a little-endian int32 count,
// followed by `count` int16 little-endian samples (padded/truncated by packet size).
function decodeMetersBlob(data) {
  try {
    if (!data || data.length < 4) return null;
    const count = data.readInt32LE(0);
    if (!Number.isFinite(count) || count <= 0) return null;

    const available = Math.floor((data.length - 4) / 2);
    const slotCount = Math.min(count, available);
    if (slotCount <= 0) return null;

    // Defensive cap: if a malformed packet claims huge count, do not allocate excessively.
    const capped = Math.min(slotCount, 4096);
    const values = new Int16Array(capped);
    for (let i = 0; i < capped; i++) {
      values[i] = data.readInt16LE(4 + i * 2);
    }

    return { count, slotCount: capped, values };
  } catch (e) {
    // Never let meter decoding throw and stall the OSC receive loop.
    if (DEBUG_METERS || DEBUG_OSC) {
      console.warn('METER decode failed:', e && e.message ? e.message : e);
    }
    return null;
  }
}

// Handle incoming OSC packets (we assume XR18 replies as single messages)
function handleOscPacket(buf) {
  const msg = decodeOscMessage(buf);
  if (!msg) return;

  const addr = msg.address;
  const args = msg.args || [];

  // For debug: log everything coming from mixer
  if (DEBUG_OSC) {
    console.log('OSC RAW:', addr, args.map(a => a && a.value));
  }

  // Handle meter blobs: meters/<set> (optionally with leading slash) with one blob argument
  const mMeters = addr.match(/^\/?meters\/(\d+)$/);
  if (mMeters) {
    const setIndex = parseInt(mMeters[1], 10);
    if (Number.isNaN(setIndex)) return;
    if (!args.length) return;
    const blobArg = args[0];
    if (!blobArg || blobArg.type !== 'b' || !blobArg.value) return;

    const data = blobArg.value; // Buffer with raw meter data
    // Note meter activity for safe-state
    lastMetersRxAt = Date.now();
    updateAndBroadcastSafeState(lastMetersRxAt);

    // XR18: /meters/1 blob payload:
    //  - first 4 bytes: little-endian int32 = number of int16 values
    //  - then that many 16-bit little-endian signed meter samples
    const decoded = decodeMetersBlob(data);
    if (!decoded) return;
    const values = decoded.values;

    if (setIndex === 1) {
      // Convert raw 1/256-dB samples to 0–1 levels
      // FX returns are stereo; use L/R pairs and take the max as the meter value.
      // Mapping inferred from capture and behavior:
      //   FX1: indices 18,19
      //   FX2: indices 20,21
      //   FX3: indices 22,23
      //   FX4: indices 24,25
      const fxPairs = [
        [18, 19], // FX1
        [20, 21], // FX2
        [22, 23], // FX3
        [24, 25], // FX4
      ];

      fxPairs.forEach((pair, n) => {
        const [iL, iR] = pair;
        if (iL >= values.length) return;

        const rawL = values[iL];
        let raw = rawL;
        if (iR < values.length) {
          const rawR = values[iR];
          raw = Math.max(rawL, rawR);
        }

        const db = rawToDb(raw);
        const level = dbToLevel(db, FX_METER_FLOOR_DB);
        const fx = n + 1;

        // Signal-present: true if db exceeds threshold (valid signal above noise floor)
        // Only true when we have valid meter data and signal is present
        const signalPresent = Number.isFinite(db) && db > SIGNAL_PRESENT_THRESHOLD_DB;

        if (DEBUG_METERS) {
          console.log(`METER FX${fx}: raw=${raw} dB=${db.toFixed(1)} lvl=${level.toFixed(2)} signalPresent=${signalPresent}`);
        }

        // Broadcast to plugin as a 'meter' kind; plugin can choose how to render
        broadcastState({
          fx,
          kind: 'meter',
          value: level,
          signalPresent
        });
      });

      // Also compute meters for registered channel targets (inputs 1..16 use indices 0..15)
      channelTargets.forEach((t) => {
        if (t.targetType !== 'ch') return;
        const chIdx = t.targetIndex;
        if (!Number.isFinite(chIdx) || chIdx < 1) return;
        const meterIndex = chIdx - 1; // ch1 -> index 0, ch16 -> index 15
        if (meterIndex < 0 || meterIndex >= values.length) return;

        const raw = values[meterIndex];
        const db = rawToDb(raw);
        const level = dbToLevel(db, KEY_METER_FLOOR_DB);

        // Signal-present: true if db exceeds threshold (valid signal above noise floor)
        // Only true when we have valid meter data and signal is present
        const signalPresent = Number.isFinite(db) && db > SIGNAL_PRESENT_THRESHOLD_DB;

        broadcastChannelState({
          targetType: 'ch',
          targetIndex: chIdx,
          meter: level,
          signalPresent
        });
      });

      return;
    }
  }

  // Handle mixbus names: /bus/N/config/name <string>
  const mBusName = addr.match(/^\/bus\/(\d+)\/config\/name$/);
  if (mBusName) {
    const busIndex = parseInt(mBusName[1], 10);
    if (!Number.isNaN(busIndex) && (busIndex === 2 || busIndex === 4 || busIndex === 6) && args.length > 0) {
      const nameArg = args[0];
      const name = String(nameArg && nameArg.value ? nameArg.value : '').trim();
      if (name.length > 0) {
        busNames[busIndex] = name;
        if (DEBUG_OSC) {
          console.log('OSC REPLY BUS NAME:', addr, name);
        }
        broadcastBusNamesToAllFx();
      }
    }
    return;
  }

  // Handle FX return names: /rtn/N/config/name <string>
  const mName = addr.match(/^\/rtn\/(\d+)\/config\/name$/);
  if (mName) {
    const fxName = parseInt(mName[1], 10);
    if (!Number.isNaN(fxName) && fxName >= 1 && fxName <= 4 && args.length > 0) {
      const nameArg = args[0];
      const name = String(nameArg && nameArg.value ? nameArg.value : '').trim();
      if (DEBUG_OSC) {
        console.log('OSC REPLY NAME:', addr, name);
      }
      broadcastState({
        fx: fxName,
        kind: 'name',
        name
      });
    }
    return;
  }

  // Handle channel names for Channel Button: /ch/NN/config/name <string>
  const mChName = addr.match(/^\/ch\/(\d+)\/config\/name$/);
  if (mChName) {
    const chIndex = parseInt(mChName[1], 10);
    if (!Number.isNaN(chIndex) && chIndex >= 1 && args.length > 0) {
      const nameArg = args[0];
      const name = String(nameArg && nameArg.value ? nameArg.value : '').trim();
      if (DEBUG_OSC) {
        console.log('OSC REPLY CH NAME:', addr, name);
      }

      // Update registry
      const existing = channelTargets.find(
        (t) => t.targetType === 'ch' && t.targetIndex === chIndex
      );
      if (existing) {
        existing.name = name;
      }

      broadcastChannelState({
        targetType: 'ch',
        targetIndex: chIndex,
        name
      });
    }
    return;
  }

  // Handle channel mute for Channel Button: /ch/NN/mix/on <int 0|1>
  const mChMix = addr.match(/^\/ch\/(\d+)\/mix\/on$/);
  if (mChMix) {
    const chIndex = parseInt(mChMix[1], 10);
    if (!Number.isNaN(chIndex) && chIndex >= 1 && args.length > 0) {
      const raw = Number(args[0].value);
      const muted = (raw === 0); // XR18: 1 = ON (unmuted), 0 = muted

      if (DEBUG_OSC) {
        console.log('OSC REPLY CH MUTE:', addr, raw);
      }

      const existing = channelTargets.find(
        (t) => t.targetType === 'ch' && t.targetIndex === chIndex
      );
      if (existing) {
        existing.muted = muted;
      }

      broadcastChannelState({
        targetType: 'ch',
        targetIndex: chIndex,
        muted
      });
    }
    return;
  }

  // Expect replies like:
  //   /rtn/1/mix/fader <float>
  //   /rtn/1/mix/on    <int 0|1>
  //   /rtn/1/mix/01/grpon <int 0|1> (bus A)
  //   /rtn/1/mix/03/grpon <int 0|1> (bus B)
  //   /rtn/1/mix/05/grpon <int 0|1> (bus C)
  
  // Check for bus assignment paths first: /rtn/N/mix/XX/grpon
  const mBus = addr.match(/^\/rtn\/(\d+)\/mix\/(\d+)\/grpon$/);
  if (mBus) {
    const fx = parseInt(mBus[1], 10);
    const busIndex = parseInt(mBus[2], 10);
    if (Number.isNaN(fx) || fx < 1 || fx > 4) return;
    if (args.length === 0) return;
    const raw = Number(args[0].value);
    const assigned = (raw === 1);

    if (DEBUG_OSC) {
      console.log('OSC REPLY BUS ASSIGN:', addr, raw, 'assigned=', assigned);
    }

    // Map bus index to bus letter (01=A, 03=B, 05=C)
    let busField = null;
    if (busIndex === 1) busField = 'busA';
    else if (busIndex === 3) busField = 'busB';
    else if (busIndex === 5) busField = 'busC';

    if (busField) {
      broadcastState({
        fx,
        kind: busField,
        [busField]: assigned
      });
    }
    return;
  }

  // Handle fader and mute paths: /rtn/N/mix/fader or /rtn/N/mix/on
  const m = addr.match(/^\/rtn\/(\d+)\/mix\/(fader|on)$/);
  if (!m) return;

  const fx = parseInt(m[1], 10);
  if (Number.isNaN(fx) || fx < 1 || fx > 4) return;

  const kind = m[2];
  if (kind === 'fader') {
    if (args.length === 0) return;
    const value = Number(args[0].value);
    if (!Number.isFinite(value)) return;

    if (DEBUG_OSC) {
      console.log('OSC REPLY FADER:', addr, value);
    }
    broadcastState({
      fx,
      kind: 'fader',
      value
    });
  } else if (kind === 'on') {
    if (args.length === 0) return;
    const raw = Number(args[0].value);
    // XR18: /mix/on = 1 → channel ON (unmuted), 0 → channel muted
    const muted = (raw === 0);

    if (DEBUG_OSC) {
      console.log('OSC REPLY MUTE:', addr, raw);
    }
    broadcastState({
      fx,
      kind: 'mute',
      muted
    });
  }
}

// UDP socket events
udp.on('listening', () => {
  const addr = udp.address();
  console.log(`OSC UDP listening on ${addr.address}:${addr.port}, target ${XR18_IP}:${XR18_PORT}`);
  subscribeMeters();

  // Ask mixer to send remote updates using the same flavor as X-Air Edit
  sendOscQuery('/xremotenfb');
  // Keep the remote session alive (~every 5s) so updates (including meters) don't stop
  setInterval(() => sendOscQuery('/xremotenfb'), 5000);

  // Initial poll when OSC is ready
  pollAllFx();
  pollMeters();
  pollBusNames();
  broadcastBusNamesToAllFx();

  // Poll periodically to stay in sync even if other controllers move the mixer
  setInterval(pollAllFx, 1000);
  setInterval(pollChannelTargets, 1000);
  // Renew meter subscription periodically for live levels (every ~1s)
  setInterval(pollMeters, 1000);
  // Bus names rarely change; poll occasionally
  setInterval(pollBusNames, 5000);
});

udp.on('message', (msg /*, rinfo */) => {
  lastOscRxAt = Date.now();
  updateAndBroadcastSafeState(lastOscRxAt);
  handleOscPacket(msg);
});

udp.on('error', (err) => {
  console.error('UDP error:', err);
});

// Bind UDP socket to our fixed local port
udp.bind(LOCAL_OSC_PORT);

// WebSocket handling for plugin messages
wss.on('connection', (ws) => {
  console.log('BRIDGE: plugin WebSocket connected');
  // Send current safe-state immediately on connect
  updateAndBroadcastSafeState(Date.now());
  broadcastConnectionState(lastSafeState);

  // Send current paired-bus display names immediately on connect (so Assign Mode labels are correct before next poll)
  try {
    ws.send(JSON.stringify({
      type: MSG_FX_STATE || 'fxState',
      fxIndex: 1,
      busAName: busNames[2],
      busBName: busNames[4],
      busCName: busNames[6],
    }));
    ws.send(JSON.stringify({
      type: MSG_FX_STATE || 'fxState',
      fxIndex: 2,
      busAName: busNames[2],
      busBName: busNames[4],
      busCName: busNames[6],
    }));
    ws.send(JSON.stringify({
      type: MSG_FX_STATE || 'fxState',
      fxIndex: 3,
      busAName: busNames[2],
      busBName: busNames[4],
      busCName: busNames[6],
    }));
    ws.send(JSON.stringify({
      type: MSG_FX_STATE || 'fxState',
      fxIndex: 4,
      busAName: busNames[2],
      busBName: busNames[4],
      busCName: busNames[6],
    }));
  } catch (e) {
    // ignore send failures; normal polling will update
  }
  ws.on('message', (data) => {
    const raw = data.toString();
    logPluginToBridge(raw);

    let msg;
    if (typeof parseMessage === 'function') {
      msg = parseMessage(raw);
    } else {
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
    }

    if (!msg || typeof msg !== 'object') {
      return;
    }

    if (DEBUG_WS) {
      console.log('BRIDGE RECEIVED:', msg);
    }

    // ---- T009 Safe-state gate: block control writes unless LIVE ----
    // Allow handshake/sync/registration to proceed even if STALE/OFFLINE.
    const isControlWrite = (
      msg.type === MSG_SET_FX_FADER ||
      msg.type === MSG_SET_FX_MUTE ||
      msg.type === MSG_SET_CHANNEL_FADER ||
      msg.type === MSG_SET_CHANNEL_MUTE ||
      msg.type === 'fader' ||
      msg.type === 'mute' ||
      msg.type === 'channelToggleMute'
    );

    if (isControlWrite && !maySendControl()) {
      const err = {
        type: MSG_ERROR || 'error',
        code: 'SAFE_STATE_BLOCK',
        message: `Control blocked while ${lastSafeState}`,
      };
      const json = JSON.stringify(err);
      logBridgeToPlugin(json);
      ws.send(json);
      return;
    }

    // Protocol-style handshake / high-level requests (if wsProtocol is present)
    if (msg.type === MSG_HELLO) {
      if (MSG_WELCOME) {
        ws.send(JSON.stringify({
          type: MSG_WELCOME,
          protocolVersion: 1,
        }));
      }
      return;
    }

    if (msg.type === MSG_REQUEST_FULL_STATE) {
      // For now, "full state" = poll FX + registered channels; OSC replies will be broadcast.
      pollAllFx();
      pollChannelTargets();
      return;
    }

    // Existing / legacy message types below ----------------------------

    if (msg.type === 'log') {
      // Plugin-forwarded logs are optional and can be very noisy.
      if (DEBUG_PLUGIN_LOG) {
        console.log('PLUGIN LOG:', msg.tag, msg.payload);
      }
      return;
    }

    // Explicit sync request from plugin (e.g. on willAppear)
    if (msg.type === 'sync') {
      if (typeof msg.fx === 'number' && msg.fx >= 1 && msg.fx <= 4) {
        pollFx(msg.fx);     // poll just this FX
      } else {
        pollAllFx();        // or fall back to all, if fx is missing
      }
      return;
    }

    // Channel Button registration: remember target and poll its state
    if (msg.type === 'channelRegister') {
      const targetType = msg.targetType || 'ch';
      const idx = Number(msg.targetIndex);
      if (targetType === 'ch' && Number.isFinite(idx) && idx >= 1) {
        let existing = channelTargets.find(
          (t) => t.targetType === 'ch' && t.targetIndex === idx
        );
        if (!existing) {
          existing = { targetType: 'ch', targetIndex: idx };
          channelTargets.push(existing);
        }
        const chId = pad2(idx);
        sendOscQuery(`/ch/${chId}/mix/on`);
        sendOscQuery(`/ch/${chId}/config/name`);
      }
      return;
    }

    // Channel Button toggle mute: flip last-known state and send OSC
    if (msg.type === 'channelToggleMute') {
      const targetType = msg.targetType || 'ch';
      const idx = Number(msg.targetIndex);
      if (targetType === 'ch' && Number.isFinite(idx) && idx >= 1) {
        let existing = channelTargets.find(
          (t) => t.targetType === 'ch' && t.targetIndex === idx
        );
        if (!existing) {
          existing = { targetType: 'ch', targetIndex: idx, muted: false };
          channelTargets.push(existing);
        }
        const currentMuted = !!existing.muted;
        const nextMuted = !currentMuted;
        const chId = pad2(idx);
        // XR18: /mix/on = 1 → channel ON (unmuted), 0 → channel muted
        const xrOn = nextMuted ? 0 : 1;

        if (DEBUG_OSC_SEND) console.log('SEND OSC CH MUTE:', `/ch/${chId}/mix/on`, xrOn);
        sendOscInt(`/ch/${chId}/mix/on`, xrOn);

        existing.muted = nextMuted;

        // Echo to channel button clients immediately
        broadcastChannelState({
          targetType: 'ch',
          targetIndex: idx,
          muted: nextMuted
        });
      }
      return;
    }

    // New protocol-style FX control messages, mapping to the same OSC behavior as legacy "fader"/"mute"
    if (msg.type === MSG_SET_FX_FADER) {
      let fx = Number(msg.fxIndex ?? msg.fx);
      if (!Number.isFinite(fx) || fx < 1 || fx > 4) return;

      let v = Number(msg.value);
      if (!Number.isFinite(v)) return;
      if (v < 0) v = 0;
      if (v > 1) v = 1;

      if (DEBUG_OSC_SEND) console.log('SEND OSC FADER:', fxPath(fx, 'mix/fader'), v);
      sendOscFloat(fxPath(fx, 'mix/fader'), v);

      // Echo state immediately so UI feels responsive
      broadcastState({
        fx,
        kind: 'fader',
        value: v
      });
      return;
    }

    if (msg.type === MSG_SET_FX_MUTE) {
      let fx = Number(msg.fxIndex ?? msg.fx);
      if (!Number.isFinite(fx) || fx < 1 || fx > 4) return;

      const muted = !!msg.mute;
      // XR18 logic is reversed:
      // /mix/on = 1 → channel ON (unmuted)
      // /mix/on = 0 → channel muted
      const xrOn = muted ? 0 : 1;

      if (DEBUG_OSC_SEND) console.log('SEND OSC MUTE:', fxPath(fx, 'mix/on'), xrOn);
      sendOscInt(fxPath(fx, 'mix/on'), xrOn);

      // Echo mute state immediately using plugin-style boolean
      broadcastState({
        fx,
        kind: 'mute',
        muted
      });
      return;
    }

    // Bus assignment control
    if (msg.type === MSG_SET_FX_BUS_ASSIGNMENT || msg.type === 'setFxBusAssignment') {
      let fx = Number(msg.fxIndex ?? msg.fx);
      if (!Number.isFinite(fx) || fx < 1 || fx > 4) return;

      let busIndex = Number(msg.busIndex);
      if (!Number.isFinite(busIndex)) return;
      // Only allow bus indices 1, 3, 5 (A, B, C)
      if (busIndex !== 1 && busIndex !== 3 && busIndex !== 5) return;

      const assigned = !!msg.assigned;
      const xrValue = assigned ? 1 : 0;

      const busPath = `/rtn/${fx}/mix/${String(busIndex).padStart(2, '0')}/grpon`;
      if (DEBUG_OSC_SEND) console.log('SEND OSC BUS ASSIGN:', busPath, xrValue);
      sendOscInt(busPath, xrValue);

      // Echo bus assignment state immediately
      const busField = busIndex === 1 ? 'busA' : busIndex === 3 ? 'busB' : 'busC';
      broadcastState({
        fx,
        kind: busField,
        [busField]: assigned
      });
      return;
    }

    if (!msg || !msg.fx) return;

    if (msg.type === 'fader') {
      let v = Number(msg.value);
      if (!Number.isFinite(v)) return;
      if (v < 0) v = 0;
      if (v > 1) v = 1;

      if (DEBUG_OSC_SEND) console.log('SEND OSC FADER:', fxPath(msg.fx, 'mix/fader'), v);
      sendOscFloat(fxPath(msg.fx, 'mix/fader'), v);

      // Echo state immediately so UI feels responsive
      broadcastState({
        fx: msg.fx,
        kind: 'fader',
        value: v
      });
    } else if (msg.type === 'mute') {
      const muted = !!msg.on;
      // XR18 logic is reversed:
      // /mix/on = 1 → channel ON (unmuted)
      // /mix/on = 0 → channel muted
      const xrOn = muted ? 0 : 1;

      if (DEBUG_OSC_SEND) console.log('SEND OSC MUTE:', fxPath(msg.fx, 'mix/on'), xrOn);
      sendOscInt(fxPath(msg.fx, 'mix/on'), xrOn);

      // Echo mute state immediately using plugin-style boolean
      broadcastState({
        fx: msg.fx,
        kind: 'mute',
        muted
      });
    }
  });
});

console.log(`XR18 OSC bridge WebSocket listening on ws://127.0.0.1:${BRIDGE_PORT}`);
