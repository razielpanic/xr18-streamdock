# XAir / XR18 OSC Command Reference (Extracted)

**Source:** XAir-OSC-Commands.pdf (Behringer)  [oai_citation:0‡XAir-OSC-Commands.pdf](sediment://file_000000005f0c71fdaa68a4bb656461cf)  
**Purpose:** Machine-readable reference for verification only  
**Status:** Verbatim extraction; no interpretation or normalization added

---

## Format

Each entry follows the original table structure:

| OSC Path | Type | Range | Text | Description |

---

## Actions

| OSC Path | Type | Range | Text | Description |
|--------|------|-------|------|-------------|
| /action/clearsolo | | | | Clear all solos |
| /action/initall | | | | Reinitialize console |
| /action/savestate | | | | Save current state |
| /action/setclock | | | | Set clock |
| /action/updnet | | | | LAN IP address |
| /action/wlanscan | | | | Wireless scan |

---

## Preferences

| OSC Path | Type | Range | Text | Description |
|--------|------|-------|------|-------------|
| /prefs/ap/channel | | | | WLAN channel |
| /prefs/ap/key | | | | Access Point key |
| /prefs/ap/security | | | | Access Point security |
| /prefs/ap/ssid | | | | Access Point SSID |
| /prefs/clockrate | | | | Clock rate |
| /prefs/dcamute | | | | DCA groups mute |
| /prefs/hardmute | | | | Hard mute |
| /prefs/lan/addr | | | | LAN IP address |
| /prefs/lan/gateway | | | | LAN gateway |
| /prefs/lan/mask | | | | LAN mask |
| /prefs/lan/mode | | | | LAN mode |
| /prefs/name | | | | Mixer name |

---

## Buses

| OSC Path | Type | Range | Text | Description |
|--------|------|-------|------|-------------|
| /bus/1/config/color | i | 0–15 | OFF…WHi | Mixbus color |
| /bus/1/config/name | s | | | Mixbus name |
| /bus/1/mix/fader | f | 0.0–1.0 | -∞ – +10 | Mixbus fader level |
| /bus/1/mix/on | i | 0–1 | OFF, ON | Mixbus mute |
| /bus/1/mix/lr | i | 0–1 | OFF, ON | Mixbus LR assignment |

---

## Channels

| OSC Path | Type | Range | Text | Description |
|--------|------|-------|------|-------------|
| /ch/01/config/name | s | | | Channel name |
| /ch/01/mix/fader | f | 0.0–1.0 | -∞ – +10 | Channel fader |
| /ch/01/mix/on | i | 0–1 | OFF, ON | Channel mute |
| /ch/01/mix/lr | i | 0–1 | OFF, ON | Channel LR assign |
| /ch/01/mix/01/level | f | 0.0–1.0 | -∞ – +10 | Channel → Bus send level |
| /ch/01/mix/01/pan | f | 0.0–1.0 | -100 – +100 | Channel → Bus pan |

---

## FX Sends

| OSC Path | Type | Range | Text | Description |
|--------|------|-------|------|-------------|
| /fxsend/1/config/name | s | | | FX Send name |
| /fxsend/1/mix/fader | f | 0.0–1.0 | -∞ – +10 | FX Send fader |
| /fxsend/1/mix/on | i | 0–1 | OFF, ON | FX Send mute |

---

## FX Returns (IMPORTANT FOR XD-F013)

| OSC Path | Type | Range | Text | Description |
|--------|------|-------|------|-------------|
| /rtn/1/config/name | s | | | FX Return name |
| /rtn/1/mix/fader | f | 0.0–1.0 | -∞ – +10 | FX Return fader |
| /rtn/1/mix/on | i | 0–1 | OFF, ON | FX Return mute |
| /rtn/1/mix/lr | i | 0–1 | OFF, ON | FX Return LR assignment |
| /rtn/1/mix/01/grpon | i | 0–1 | OFF, ON | FX Return → Mixbus assignment |
| /rtn/1/mix/01/level | f | 0.0–1.0 | -∞ – +10 | FX Return → Mixbus level |
| /rtn/1/mix/01/pan | f | 0.0–1.0 | -100 – +100 | FX Return → Mixbus pan |

---

## Routing

| OSC Path | Type | Range | Text | Description |
|--------|------|-------|------|-------------|
| /routing/aux/01/src | i | 0–55 | | Aux source |
| /routing/aux/01/pos | i | 0–10 | | Aux tap |
| /routing/main/01 | i | 0–10 | | Main routing |
| /routing/usb/01/src | i | 0–37 | | USB source |

---

## System

| OSC Path | Type | Range | Text | Description |
|--------|------|-------|------|-------------|
| /xinfo | | | | Returns mixer info (firmware, etc.) |

---

**Notes**
- Paths are listed exactly as extracted.
- Index numbers (`01`, `1`) indicate addressable instances.
- No behavior is implied beyond what is explicitly documented.