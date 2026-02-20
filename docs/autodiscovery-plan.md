# XD-F016 — XR18 Autodiscovery Implementation Plan

**Status:** Planned (not yet implemented)
**Decision log entry:** ARCH.md → XD-F016
**Depends on:** XD-F015 (IP config via Property Inspector / config.json)
**Last updated:** 2026-02-20

---

## Protocol: How Discovery Works

The XR18 responds to a `/xinfo` OSC broadcast. No mDNS, no special protocol.

**Client sends:**
- OSC message: `/xinfo`
- Destination: `255.255.255.255:10024` (UDP broadcast)
- Source port: any (e.g. the existing bridge UDP port 62058)

**Mixer replies:**
- OSC message: `/xinfo` from `<mixer-ip>:10024`
- `params[0]` — mixer IP address (string, e.g. `"192.168.1.32"`)
- `params[1]` — unknown / unused
- `params[2]` — model name (string, e.g. `"XR18"`)
- `params[3]` — firmware version (string)

**Confirmed by:** source analysis of [xair-remote](https://github.com/peterdikant/xair-remote) (`lib/xair.py → find_mixer()`), cross-checked against community OSC documentation.

**Timeout:** 5 seconds is sufficient. XAir Edit discovers in well under 1 second on a local subnet.

---

## Open Questions (resolve before coding)

1. **Auto-retry on address change:** If the cached IP stops responding (DHCP reassignment), should the bridge re-run discovery automatically? Or require a manual "Rediscover" trigger from the PI?
   - Leaning toward: automatic re-discovery after sustained OFFLINE (e.g. 15s with no OSC), but only one attempt per OFFLINE cycle to avoid runaway loops.

2. **Multiple X-Air devices on the same subnet:** If both an XR16 and XR18 respond to the broadcast, what does the bridge do?
   - Options: pick first responder, filter by model name `"XR18"`, or surface a selection UI in the PI.
   - Leaning toward: filter by model prefix `"XR"` and pick first (most common case). Log all responders.

Resolve these before implementation starts.

---

## Scope of Changes

### 1. `xrDock-bridge.js` — `discoverXR18()` function

- Reuse the existing UDP socket (port 62058) — it already has broadcast capability or can be enabled with `socket.setBroadcast(true)`.
- Send `/xinfo` OSC packet to `255.255.255.255:10024`.
- Listen for a `/xinfo` reply for up to 5 seconds.
- On reply: extract `params[0]` (IP) and `params[2]` (model), return `{ ip, model, firmware }`.
- On timeout: return `null`.
- Must not interfere with normal OSC session traffic if called while a session is already live.

### 2. Bridge startup sequence — config-driven discovery mode

`config.json` gains an `"ip"` field (per XD-F015). Valid values:
- `"192.168.x.x"` — use this IP directly, skip discovery.
- `"auto"` (or absent/null) — run `discoverXR18()` before starting the OSC session.

Startup flow when `ip === "auto"`:
1. Broadcast `MSG_DISCOVERY_STATE { phase: "searching" }` to all WS clients.
2. Call `discoverXR18()`.
3. **Success:** write discovered IP back to `config.json` as a literal string (cache for resilience). Log model + firmware. Proceed with OSC session startup as normal.
4. **Failure (timeout):** broadcast `MSG_DISCOVERY_STATE { phase: "failed" }`. Stay in OFFLINE state. Retry discovery every 10 seconds (same cadence as bridge reconnect). Do NOT fall back to a hardcoded IP.

The cached literal IP written back to `config.json` means subsequent bridge restarts connect immediately without re-broadcasting, while `"auto"` in config always triggers a fresh scan.

### 3. New WS message type: `MSG_DISCOVERY_STATE` (additive to `wsProtocol.js`)

Bridge → Plugin:
```json
{ "type": "discoveryState", "phase": "searching" | "found" | "failed", "ip": "192.168.1.32", "model": "XR18" }
```
- `"searching"` — broadcast sent, waiting for reply
- `"found"` — mixer located, IP resolved, OSC session starting
- `"failed"` — timeout, no mixer found, will retry

### 4. `xrDock.js` — plugin handles discovery states

New pre-connection phase between `bridgeOnline=true` and `bridgeSafeState=LIVE`:

| Condition | Tile display |
|---|---|
| Bridge online, discovery phase: `searching` | `"SEARCHING"` |
| Bridge online, discovery phase: `failed` | `"NO MIXER"` |
| Bridge online, `bridgeSafeState=OFFLINE` | `"OFFLINE"` (existing — mixer known but not responding) |
| Bridge online, `bridgeSafeState=STALE` | `"STALE"` (existing) |
| Bridge online, `bridgeSafeState=LIVE` | normal display (existing) |

No change to control write gating — discovery phase behaves identically to OFFLINE for the purposes of blocking writes.

### 5. Property Inspector — Rediscover button + IP display

- Add read-only text field showing current IP (discovered or manual).
- Add "Rediscover" button that sends `MSG_TRIGGER_DISCOVERY` to the bridge via the plugin.
- Manual IP entry remains available as a hard override — entering a literal IP sets `config.json` directly and bypasses autodiscovery.
- PI receives `MSG_DISCOVERY_STATE` updates and reflects them (e.g. "Searching..." status text while discovery is in progress).

### 6. New WS message type: `MSG_TRIGGER_DISCOVERY` (Plugin → Bridge)

```json
{ "type": "triggerDiscovery" }
```
Bridge responds by re-running `discoverXR18()` regardless of current state.

---

## What Does Not Change

- OSC session management, `/xremotenfb` keepalive, meter subscription — untouched.
- Safe-state machine (`OFFLINE` / `STALE` / `LIVE`) — untouched.
- Bridge ↔ Plugin WS protocol — additive only (new message types, no changes to existing ones).
- `XR18_IP` const in the bridge is replaced by a resolved value from the startup sequence. No hardcoded IP remains anywhere.

---

## Files Touched

| File | Change |
|---|---|
| `xrDock-bridge.js` | Add `discoverXR18()`, update startup sequence, handle `MSG_TRIGGER_DISCOVERY` |
| `xrDock.js` | Handle `MSG_DISCOVERY_STATE`, new display states `"SEARCHING"` / `"NO MIXER"` |
| `wsProtocol.js` | Add `MSG_DISCOVERY_STATE`, `MSG_TRIGGER_DISCOVERY` constants |
| `config.json` | Add `"ip"` field (may not exist yet — bridge creates it on first discovery) |
| `propertyInspector/channel/index.html` | Add Rediscover button, IP display field |
| `propertyInspector/channel/index.js` | Send `MSG_TRIGGER_DISCOVERY`, reflect discovery state |
| `docs/ARCH.md` | XD-F016 decision log entry |

---

## Reference

- [xair-remote `lib/xair.py`](https://github.com/peterdikant/xair-remote) — confirmed `/xinfo` broadcast mechanism (`find_mixer()`)
- [OSC support for X-Air — QLC+ forum](http://www.qlcplus.org/forum/viewtopic.php?t=8983) — community protocol notes
