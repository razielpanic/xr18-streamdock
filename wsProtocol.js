// wsProtocol.js
// Central definition of WebSocket messages between plugin <-> bridge.

// Message type strings
const MSG_HELLO = 'hello';
const MSG_WELCOME = 'welcome';
const MSG_REQUEST_FULL_STATE = 'requestFullState';

const MSG_SET_FX_FADER = 'setFxFader';
const MSG_SET_FX_MUTE = 'setFxMute';
const MSG_SET_FX_BUS_ASSIGNMENT = 'setFxBusAssignment';

const MSG_SET_CHANNEL_FADER = 'setChannelFader';
const MSG_SET_CHANNEL_MUTE = 'setChannelMute';

const MSG_FX_STATE = 'fxState';
const MSG_CHANNEL_STATE = 'channelState';
const MSG_METERS_FRAME = 'metersFrame';
const MSG_CONNECTION_STATE = 'connectionState';

const MSG_ERROR = 'error';

// Lightweight “interfaces” as comments (we can turn these into TS later).

/**
 * Plugin -> Bridge
 * { type: 'hello', clientId: string, protocolVersion: 1 }
 * { type: 'requestFullState' }
 * { type: 'setFxFader', fxIndex: 1|2|3|4, value: number }          // 0.0–1.0
 * { type: 'setFxMute',  fxIndex: 1|2|3|4, mute: boolean }
 * { type: 'setFxBusAssignment', fxIndex: 1|2|3|4, busIndex: 1|3|5, assigned: boolean }
 * { type: 'setChannelFader', channel: number, value: number }      // 0.0–1.0
 * { type: 'setChannelMute',  channel: number, mute: boolean }
 */

/**
 * Bridge -> Plugin
 * { type: 'welcome', protocolVersion: 1 }
 * { type: 'fxState',
 *   fxIndex: 1|2|3|4,
 *   fader?: number,              // 0.0–1.0 (partial updates: only included when changed)
 *   mute?: boolean,              // (partial updates: only included when changed)
 *   name?: string,               // (partial updates: only included when changed)
 *   meter?: number,              // 0.0–1.0 normalized level (partial updates: only included when changed)
 *   signalPresent?: boolean,     // true when signal > -80 dB threshold (only included with meter updates)
 *   busA?: boolean,              // FX Return → Bus A (mixbus 01) assignment (only included when changed)
 *   busB?: boolean,              // FX Return → Bus B (mixbus 03) assignment (only included when changed)
 *   busC?: boolean               // FX Return → Bus C (mixbus 05) assignment (only included when changed)
 * }
 * { type: 'channelState',
 *   targetType: string,          // e.g. "ch"
 *   targetIndex: number,         // channel number (1–16)
 *   muted?: boolean,             // (optional: only included when changed)
 *   meter?: number,              // 0.0–1.0 normalized level (optional: only included when changed)
 *   name?: string,               // (optional: only included when changed)
 *   signalPresent?: boolean      // true when signal > -80 dB threshold (optional: only included with meter updates)
 * }
 * { type: 'metersFrame',
 *   frameId: number,             // monotonically increasing
 *   channels: number[],          // e.g. [1,2,3,4,...]
 *   meterDb: number[]            // same length as channels
 * }
 * { type: 'connectionState',
 *   state: 'OFFLINE' | 'STALE' | 'LIVE'
 * }
 * { type: 'error', code: string, message: string }
 */

function parseMessage(raw) {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.type !== 'string') return null;
    return obj;
  } catch {
    return null;
  }
}

module.exports = {
  // type constants
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
  // helpers
  parseMessage,
};
