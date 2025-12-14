# ARCH.md — Architecture Overview

This document defines the **architectural boundaries, mental model, and failure philosophy** for the XR18 Stream Dock project. It is intentionally concise and non-prescriptive.

This project is governed by `docs/PRD.md`. If a proposed code change contradicts the PRD, the PRD should be updated first.

---

## 1. System Overview

The system consists of three cooperating components:

1. **XR18 / X-Air Mixer**
   - The authoritative source of mixer state
   - Owns routing, levels, mute states, names, and meters

2. **macOS Node.js Bridge**
   - Maintains OSC session health with the mixer
   - Decodes XR18-specific OSC messages (including `/meters/1`)
   - Normalizes and relays state over WebSocket

3. **Stream Dock Plugin**
   - Presents a tactile, always-available control surface
   - Reflects mixer truth without guessing or inferring
   - Sends explicit user intent upstream

---

## 2. State Ownership

- **The XR18 is the single source of truth.**
- The bridge reconciles, normalizes, and timestamps XR18 state.
- The plugin reflects state and issues commands; it does not infer or predict.

If state is unknown, stale, or degraded, this condition must be visible in the UI.

---

## 3. Data Flow

**State flow:**

```
XR18 → OSC → Bridge → WebSocket → Plugin
```

**Intent flow:**

```
Plugin → WebSocket → Bridge → OSC → XR18
```

Meter data is treated as **sampled signal information**, not authoritative control data.

---

## 4. Deliberate Non-Abstractions

The following choices are intentional and should not be “cleaned up” without strong justification:

- XR18 OSC paths are handled explicitly
- `/meters/1` decoding is bespoke and behavior-driven
- There is no generic or mixer-agnostic abstraction layer

Unknown or undocumented XR18 behavior must be surfaced, not guessed.

---

## 5. Failure Philosophy

- Silent failure is unacceptable
- Stale or uncertain state must be indicated
- Recovery is preferred over restart
- Correct-but-delayed is preferable to fast-but-wrong

Reliability and truthfulness take precedence over elegance or abstraction.

---

## 6. Collaboration Model

- The **human owner** defines intent, scope, and acceptance criteria
- The **programming assistant** is expected to guide implementation with expertise
- Code changes should be small, explicit, and testable

When uncertain, stop and ask. Clarity is always preferred over cleverness.

