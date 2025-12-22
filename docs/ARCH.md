# ARCH.md — Architecture Overview

This document defines the **architectural boundaries, mental model, and failure philosophy** for the XR18 Stream Dock project. It is meant to be brief and decision-oriented.

This project is governed by `docs/PRD.md`. If a proposed code change contradicts the PRD, the PRD should be updated first.

---

## 0. Decision Log

This section records **durable decisions** made during implementation so they remain stable across “New Agent” threads and refactors.
For workflow rules and completion gates, see .cursor/assistant.md.

### Template

```md
### XD-<ID> — <Short title>
**Context**
- <constraint or problem>

**Decision**
- <specific, testable choice>

**Rationale**
- <why this approach>

**Invariants Preserved**
- <must-not-regress rules>

**Confirmed Facts**
- <verified protocol paths / behaviors>

**Deferred / Open**
- <optional>
```

### Entries

### XD-F014 for v0.6.0— Clip indicator with hold
**Context**
- XR18 OSC protocol does not provide explicit clip/overload flags in meter data.
- Users need visual feedback when channels/FX are clipping.
- Clip indicators should persist briefly after clipping stops to ensure visibility.

**Decision**
- Implement clip detection via local inference: detect when raw meter value `>= -1` (equivalent to dB >= -0.0039, effectively at 0 dB threshold).
- For stereo FX returns, check both L and R channels independently - if either clips, show indicator.
- Display clip indicator as `"!"` glyph at the END of the meter bar (top of visual meter).
- Hold clip indicator for 10 seconds after last clipping detection, then auto-clear.
- Format: `"::::....!"` when clipping (clip indicator at end), vs `"::::•..."` for signal-present (bullet in middle).
- Apply to all meter types (Channel Button, FX tiles, future tile types).

**Rationale**
- Local inference is necessary since protocol doesn't provide clip flags.
- 0 dB threshold aligns with standard digital audio clipping definition.
- 10-second hold ensures brief clipping events are visible.
- End-of-bar placement (top of visual meter) is intuitive and doesn't conflict with signal-present indicator placement.

**Invariants Preserved**
- XR18 remains the single source of truth for meter data.
- Clip detection is derived from meter data, not inferred from UI state.
- Meter rendering logic remains isolated and testable.

**Confirmed Facts**
- XR18 meter values are 16-bit signed integers in 1/256 dB units.
- Values `>= -1` (raw) effectively indicate clipping (raw=-1 = -0.0039 dB, very near 0 dB threshold).
- For stereo FX returns, checking both L and R channels independently ensures clipping on either channel is detected.
- Signal-present indicator uses `•` character in middle of meter bar.
- Clip indicator uses `!` character at end of meter bar.
- Clip indicator persists during OFFLINE state (acceptable since display shows "OFFLINE" clearly) and clears on recovery.

**Deferred / Open**
- None.

---

### v0.5.0 — FX control ergonomics and minimal transport recovery
**Context**
- FX returns require live routing changes without relying on X-Air Edit.
- Stream Dock rotary input produces variable tick bursts and timing jitter.
- XR18 fader law is non-linear and UI display precision does not reflect internal resolution.
- Meter transport can stall independently of OSC control traffic (sleep, cable pull).

**Decision**
- Implement FX bus assignment directly on FX tiles with an explicit Assign Mode and safe exit paths.
- Move FX fader control to a dB-domain model with quantization at 0.1 dB near unity and speed-based acceleration.
- Match documented XR18/X32 fader law (−∞ to +10 dB) rather than inventing a custom curve.
- Add a one-shot STALE recovery in the bridge that reasserts the XR18 session and meter subscription.

**Rationale**
- Live trustworthiness matters more than implementation simplicity.
- dB-domain control aligns tactile intent with what the mixer and UI actually represent.
- A single guarded recovery attempt provides resilience without risking runaway retry loops.

**Invariants Preserved**
- XR18 remains the single source of truth for all levels, routing, and meters.
- The plugin never infers state beyond what the mixer reports.
- Recovery mechanisms must not spam logs or destabilize steady-state operation.

**Confirmed Facts**
- XR18 accepts high-resolution fader values even though X-Air Edit displays one decimal place.
- Meter data and control writes can succeed or fail independently.
- Stream Dock input events may be batched or bursty.

**Deferred / Open**
- Multi-attempt or adaptive recovery strategies are deferred to a future release if needed.

### v0.4.0 — Meter safe-state truthfulness and signal-present indicator
**Context**
- `/meters/1` can stop updating without a clean transport teardown.
- UI state can otherwise appear “live” while showing last-known values.

**Decision**
- Treat missing meter frames as **STALE**.
- Freeze meter visuals and show a clear “not live” state.
- Signal-present indicators must never remain “on” from stale data.

**Rationale**
- False confidence during live use is worse than temporary loss of information.

**Invariants Preserved**
- XR18 remains the single source of truth.
- The plugin must not infer signal state when meter data is stale.

**Confirmed Facts**
- Meter updates and control writes can fail independently.

**Deferred / Open**
- Automatic transport-level recovery is tracked separately (see XD-B002).


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

- Silent failure is unacceptable.
- Stale/uncertain state must be visible.
- Prefer recovery over restart.
- Prefer correct-but-delayed over fast-but-wrong.

Reliability and truthfulness take precedence over elegance or abstraction.

---

## 6. Debugging & Observability

- Plugin UI/runtime behavior should be treated as **embedded Chromium** semantics (rendering, lifecycle, timing).
- During development, VSD Craft may expose a localhost Chromium DevTools endpoint for inspecting the running UI process.
- See `docs/DEBUGGING.md` for the authoritative debugging workflow and constraints (LLMs reason over surfaced artifacts, not live runtime state).

---

## 7. Platform Constraints & Known Limitations

### Stream Dock / VSD Text Rendering
- Unicode may be supported by the renderer.
- Literal Unicode characters in JS source are unreliable in the plugin host.
- If Unicode is used, it must be generated via escapes (\uXXXX) or String.fromCodePoint(...).
- All non-ASCII UI experiments must be tested on-device.

#### Notes:
- Future VSD updates *may* improve Unicode support.
- Workarounds (e.g., custom bitmaps or SVG rendering) may be explored later,
  but should not be assumed in current implementations.

### Design Decisions Driven by Platform Limits
- Raised-floor meters and text-based indicators are used instead of graphical glyphs
  due to VSD rendering constraints.
- UI clarity and predictability are prioritized over visual richness.
- These are intentional; don’t propose Unicode/glyph-based UI improvements unless the rendering constraint is explicitly revisited.