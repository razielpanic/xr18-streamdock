# Product Requirements Document

**Project:** XR18 Stream Dock Control Surface  
**Status:** Draft (Post-Prototype, Pre–v 1.0)  
**Owner:** Raziel Panic  
**Last Updated:** 2025-12-14

---

## 1. Product Overview

The XR18 Stream Dock Control Surface is a Stream Dock plugin that uses the device’s knobs and buttons, in conjunction with a macOS Node.js bridge, to provide **reliable, low-latency, bi-directional control and metering** for the Behringer XR18/X-Air mixer over the OSC protocol.

The product prioritizes **trustworthy state synchronization** over feature breadth, enabling the Stream Dock to act as a first-class XR18 control surface of **limited, monitoring-centric scope** (common level/mute tasks plus everyday bus routing between a small set of sources and destinations).

---

## 2. Problem Statement

For the most-used XR18 operations, the desired experience is closer to a hardware-only mixer: **trustworthy state, tactile control, and a permanent, learnable layout**.

Existing approaches tend to force a tradeoff:

- Dedicated hardware controllers can provide tactility and learnability, but are large and expensive.
- Minimalist controllers reduce cost and size, but rely on banking/mode switching and weak labeling, which reduces learnability and confidence.
- Screen-based control via the X AIR app keeps the mixer controllable, but adds ongoing on-screen UI presence that is inefficient for frequent operations (mouse targeting), visual overkill, and distracting.

This project provides a **small, legible, always-truthful control surface** for common XR18 tasks, minimizing reliance on on-screen mixing UI for day-to-day operation. A key recurring need is routing a small set of everyday stereo sources to multiple monitoring/recording/teleconference destinations without living in X AIR Edit.

---

## 3. Target User

Primary user:

- The author of this project, building a personal solution for a **studio/desktop workflow**
- Uses the XR18 primarily as an **audio interface surfaced in a DAW** (e.g., Ableton Live) while needing a separate, always-available surface for **control-room monitoring** tasks that were previously handled in X AIR Edit
- Most-used controls are expected to center on stereo channel sources, bus destinations, and **live mics used in daily monitoring and teleconferencing**
- Technically literate and comfortable installing and maintaining a companion bridge process

Secondary context (musicianship / live use):

- The system could remain usable for recording, rehearsal, and performance scenarios, but that is not the primary driver of design decisions

Secondary users (speculative, not a v 1.0 driver):

- Other technically inclined XR18 users with similar preferences for tactile, always-available controls

The product assumes **intentional use**, not casual discovery. Any consideration of additional users exists to keep design decisions generalizable, not because broad productization is a primary goal.

---

## 4. Design Principles (Non-Negotiable)

1. **Truth over cleverness**\
   If state cannot be guaranteed correct, it must be visually or behaviorally indicated.

2. **Bi-directional synchronization is mandatory**\
   UI state must reflect mixer state even when changed externally.

3. **Reliability beats features**\
   A smaller feature set that never lies is preferred to a richer but brittle UI.

4. **Explicit handling of protocol ambiguity**\
   Unknown or undocumented XR18 behavior must be surfaced, not guessed.

5. **Separation of concerns**\
   UI, transport, protocol decoding, and session management remain distinct modules.

---

## 5. In-Scope Capabilities (v 1.0)

**Primary studio/monitoring scope:** The v 1.0 feature set is driven by day-to-day control-room monitoring needs while the XR18 is being used as a DAW audio interface. The default assumption is frequent control of a small set of stereo sources (e.g., system audio, teleconference audio, DAW return, cue/talkback mic) and their **bus routing to monitoring and recording destinations** (DAW inputs, teleconferencing apps, monitor feeds). This includes **indicating and assigning** the relevant bus routes for these everyday paths. Broader live-mixing workflows remain secondary and must not expand scope without a reliability justification.

### Mixer Control

- Channel faders (including the FX channels assigned stereo USB inputs)
- Channel mute states
- Channel naming
- Monitoring-centric bus route **indication and assignment** for the defined everyday sources/destinations
- Bus-related controls already proven stable in the current implementation

### Metering

- Real-time level meters decoded from `/meters/1`
- Stable floor and scale handling (signal present, but no floor detail)
- Predictable update cadence

### Transport & Session

- Robust OSC session maintenance (`/xremote`, `/renew`)
- Automatic resubscription after connection loss
- Deterministic bridge ↔ plugin communication over WebSocket

### UI

- Text-based meters and labels
- Persistent channel configuration per button/action
- Clear differentiation between known-good and degraded states

---

## 6. Explicit Non-Goals

**Boundary on routing:** v 1.0 includes monitoring-centric bus routing for a small, defined set of everyday source→destination paths (Section 5). It does **not** aim to expose or manage the full XR18 routing matrix or broader system design.

The following are intentionally **out of scope** for v 1.0:

- MIDI bridge or MIDI-only operation
- Full mixer configuration beyond the monitoring-centric bus routing described in Section 5 (e.g., comprehensive routing matrix management, preamp gain, FX design)
- High-FPS animated graphics beyond proven meter performance
- Complex SVG layering or arbitrary vector rendering
- Headless or fully embedded operation (bridge is acceptable)

These may be revisited only if they do not compromise reliability, and only after v 1.0 ships.

---

## 7. System Architecture Constraints

- Stream Dock plugin runs in SDK-defined environment
- Companion bridge runs on macOS Node.js (latest LTS)
- OSC communication must not assume undocumented XR18 behavior
- Distribution may bundle files, but the source must remain modular (no development-time monolith)
- All protocol boundaries must be inspectable and testable

---

## 8. User Experience Requirements

- No control may silently fail
- If state is stale, the UI must visibly communicate uncertainty
- User actions must feel immediate, even if confirmation is delayed
- Meter behavior must be smooth *and* useful, not merely animated

---

## 9. Reliability & Failure Handling

The system must:

- Recover from XR18 power cycling without restart
- Recover from network loss without user intervention
- Avoid “locked” meters or frozen UI states
- Prefer safe fallback over speculative recovery

Failure modes are not bugs unless they violate these principles.

---

## 10. Baseline Stability Milestone (v 1.0)

v 1.0 represents a **personal baseline of stability and trustworthiness**, not a commercial or public product release.

This milestone is defined as:

- No known state-desynchronization bugs in normal operation
- Stable channel control (fader, mute, name, meters as applicable)
- Stable bus assignment control and display (color pips for 3 stereo pairs, functional edit mode)
- Proven session resilience across extended personal use
- Backlog free of P1 reliability issues affecting day-to-day use
- PRD principles still accurate and not contradicted by implementation

---

## 11. Open Questions / Deferred Decisions

- Internal MIDI bridge feasibility and user perception
- SVG rendering performance limits in SDK
- Packaging expectations for Stream Dock store submission

These are intentionally deferred until after v 1.0, unless they are required to fix a reliability issue or unblock store submission.

---

## 12. Appendix: Existing XR/X-Air Libraries, Tools, and Protocol References

This project was built by implementing the XR18/X-Air OSC behaviors needed for a limited-scope control surface (including meter decoding and session maintenance). There are existing community tools and libraries that may have reduced early reverse-engineering effort if evaluated sooner; however, adopting them later can be higher-risk than continuing with known-good behavior.

### Official / Primary Protocol Reference

- **X AIR Mixer Series Remote Control Protocol (OSC)** (Music Tribe PDF; includes protocol description and points to the Parameters.txt mapping file referenced by the document).

### Community Tools (Utilities / Proxies)

- **XAirUtilities**: cross-platform utilities for sending/listening to OSC, and for getting/setting scenes against X-Air mixers.
- **tarsjoris/x-air**: community tooling for X-Air series mixers (proxy-style workflow; varies by tool).

### Existing Integrations (Control Surfaces)

- **Bitfocus Companion module (Behringer X-Air)**: a mature integration module that maps a large number of X-Air OSC commands for Companion-style control surfaces.

### Higher-Level APIs / Libraries

- **xair-api (Python)**: a higher-level API that abstracts X-Air/MR series control.

**Guidance for future evaluation:** Include these in the project reference resources. Adopting a third-party library at this stage is **not expected** and would require a clear net benefit over the existing, proven implementation. Treat any third-party library as a **candidate dependency**, but adopt it only behind a small internal adapter and only after regression tests prove it preserves the current known-good behaviors (FX returns bi-directional control; channel button persistence; meters floor + unlock behavior; session recovery).

