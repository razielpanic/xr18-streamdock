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
  MSG_SET_CHANNEL_FADER,
  MSG_SET_CHANNEL_MUTE,
  MSG_FX_STATE,
  MSG_CHANNEL_STATE,
  MSG_METERS_FRAME,
  MSG_CONNECTION_STATE,
  MSG_ERROR,
  parseMessage,
} = wsProtocol;

// Debug flags
const DEBUG_OSC    = false;
const DEBUG_WS     = false;
const DEBUG_JSON   = false; // JSON traffic bridge <-> plugin
const DEBUG_METERS = false; // per-meter logging

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
function logPluginToBridge(raw) {
  if (!DEBUG_JSON) return;
  console.log('[PLUGIN → BRIDGE]', raw);
}

function logBridgeToPlugin(raw) {
  if (!DEBUG_JSON) return;
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
const FX_METER_FLOOR_DB = -90;
const KEY_METER_FLOOR_DB = -60;

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
  const payload = JSON.stringify({
    type: MSG_CHANNEL_STATE || 'channelState',
    targetType: state.targetType,
    targetIndex: state.targetIndex,
    muted: state.muted,
    meter: state.meter,
    name: state.name
  });
  logBridgeToPlugin(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Poll a single FX return for its current fader and mute state
function pollFx(fx) {
  // Query current value by sending address with no arguments
  sendOscQuery(fxPath(fx, 'mix/fader'));
  sendOscQuery(fxPath(fx, 'mix/on'));
  sendOscQuery(`/rtn/${fx}/config/name`);
}

// Poll all four FX returns
function pollAllFx() {
  [1, 2, 3, 4].forEach(pollFx);
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

        if (DEBUG_METERS) {
          console.log(`METER FX${fx}: raw=${raw} dB=${db.toFixed(1)} lvl=${level.toFixed(2)}`);
        }

        // Broadcast to plugin as a 'meter' kind; plugin can choose how to render
        broadcastState({
          fx,
          kind: 'meter',
          value: level
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

        broadcastChannelState({
          targetType: 'ch',
          targetIndex: chIdx,
          meter: level
        });
      });

      return;
    }
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
  const m = addr.match(/^\/rtn\/(\d+)\/mix\/(fader|on)$/);
  if (!m) return;

  const fx = parseInt(m[1], 10);
  const kind = m[2];
  if (Number.isNaN(fx) || fx < 1 || fx > 4) return;

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

  // Poll periodically to stay in sync even if other controllers move the mixer
  setInterval(pollAllFx, 1000);
  setInterval(pollChannelTargets, 1000);
  // Renew meter subscription periodically for live levels (every ~1s)
  setInterval(pollMeters, 1000);
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
      if (DEBUG_WS || DEBUG_JSON) {
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

        console.log('SEND OSC CH MUTE:', `/ch/${chId}/mix/on`, xrOn);
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

      console.log('SEND OSC FADER:', fxPath(fx, 'mix/fader'), v);
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

      console.log('SEND OSC MUTE:', fxPath(fx, 'mix/on'), xrOn);
      sendOscInt(fxPath(fx, 'mix/on'), xrOn);

      // Echo mute state immediately using plugin-style boolean
      broadcastState({
        fx,
        kind: 'mute',
        muted
      });
      return;
    }

    if (!msg || !msg.fx) return;

    if (msg.type === 'fader') {
      let v = Number(msg.value);
      if (!Number.isFinite(v)) return;
      if (v < 0) v = 0;
      if (v > 1) v = 1;

      console.log('SEND OSC FADER:', fxPath(msg.fx, 'mix/fader'), v);
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

      console.log('SEND OSC MUTE:', fxPath(msg.fx, 'mix/on'), xrOn);
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
