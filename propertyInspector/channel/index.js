//
//  index.js
//  
//
//  Created by Raziel Panic on 12/2/25.
//


// XR18 Channel Button – Property Inspector
// Stores { targetIndex: N } as settings and tells the plugin when it changes.

let piSocket = null;
let piUUID = null;
let piRegisterEvent = null;
let piInfo = null;
let piSettings = {};

// Called by Stream Dock when PI loads
function connectElgatoStreamDeckSocket(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {
  piUUID = inUUID;
  piRegisterEvent = inRegisterEvent;
  piInfo = inInfo;

  piSocket = new WebSocket('ws://127.0.0.1:' + inPort);

  piSocket.onopen = function () {
    // Register this property inspector
    piSocket.send(JSON.stringify({
      event: piRegisterEvent,
      uuid: piUUID
    }));

    // Ask for current settings for this instance
    piSocket.send(JSON.stringify({
      event: 'getSettings',
      context: piUUID
    }));
  };

  piSocket.onmessage = function (evt) {
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch (_) {
      return;
    }

    const event = msg.event;
    if (event === 'didReceiveSettings') {
      const payload = msg.payload || {};
      const s = payload.settings || {};
      piSettings = s;
      applySettingsToUI();
    }
  };
}

function applySettingsToUI() {
  const idxEl = document.getElementById('targetIndex');
  if (!idxEl) return;

  // Prefer new targetIndex, but fall back to older "channel" if present
  const v = (piSettings.targetIndex !== undefined && piSettings.targetIndex !== null)
    ? piSettings.targetIndex
    : piSettings.channel;

  if (typeof v === 'number' || typeof v === 'string') {
    idxEl.value = v;
  } else {
    idxEl.value = '1'; // soft default to channel 1 only when nothing is stored
  }
}

function saveSettings() {
  if (!piSocket || piSocket.readyState !== WebSocket.OPEN || !piUUID) return;

  const idxEl = document.getElementById('targetIndex');
  if (!idxEl) return;

  const raw = parseInt(idxEl.value, 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return;
  }

  piSettings.targetIndex = raw;
  // Keep legacy "channel" in sync so older code or stored settings still work
  piSettings.channel = raw;

  // Persist settings on the host
  piSocket.send(JSON.stringify({
    event: 'setSettings',
    context: piUUID,
    payload: piSettings
  }));

  // Tell the plugin immediately which channel to use
  piSocket.send(JSON.stringify({
    event: 'sendToPlugin',
    action: 'com.youshriek.xr18channel',
    context: piUUID,
    payload: {
      type: 'channelConfig',
      targetIndex: raw
    }
  }));
}

document.addEventListener('DOMContentLoaded', function () {
  const idxEl = document.getElementById('targetIndex');
  if (!idxEl) return;

  idxEl.addEventListener('change', saveSettings);
  idxEl.addEventListener('blur', saveSettings);
  idxEl.addEventListener('keyup', function (e) {
    if (e.key === 'Enter') saveSettings();
  });
});
