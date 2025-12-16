// wsProtocol.js
// Central definition of WebSocket messages between plugin <-> bridge.

// Message type strings
const MSG_HELLO = 'hello';
const MSG_WELCOME = 'welcome';
const MSG_REQUEST_FULL_STATE = 'requestFullState';

const MSG_SET_FX_FADER = 'setFxFader';
const MSG_SET_FX_MUTE = 'setFxMute';

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
 * { type: 'setChannelFader', channel: number, value: number }      // 0.0–1.0
 * { type: 'setChannelMute',  channel: number, mute: boolean }
 */

/**
 * Bridge -> Plugin
 * { type: 'welcome', protocolVersion: 1 }
 * { type: 'fxState',
 *   fxIndex: 1|2|3|4,
 *   fader: number,               // 0.0–1.0
 *   mute: boolean,
 *   name: string,
 *   meterDb: number | null       // e.g. -60..0, null if unknown
 * }
 * { type: 'channelState',
 *   channel: number,
 *   fader: number,               // 0.0–1.0
 *   mute: boolean,
 *   name: string,
 *   meterDb: number | null
 * }
 * { type: 'metersFrame',
 *   frameId: number,             // monotonically increasing
 *   channels: number[],          // e.g. [1,2,3,4,...]
 *   meterDb: number[]            // same length as channels
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
