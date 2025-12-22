# XD-F014 Clip Indicator Research

**Date:** 2025-01-XX  
**Purpose:** Research findings on XR18 OSC protocol clip/overload detection capabilities

---

## Summary

**Conclusion:** The XR18 OSC protocol does **not** provide explicit clip/overload flags in the meter data. Clip detection must be implemented via **local inference** by monitoring meter dB values.

---

## Community Source Review

### 1. Official Protocol Documentation

**Source:** X AIR Mixer Series Remote Control Protocol (OSC) PDF

**Findings:**
- Meter data is provided as binary blobs via `/meters/N` subscriptions
- Each meter value is a **16-bit signed integer** with resolution of **1/256 dB**
- Meter ID 1 (which we use) provides 40 values covering:
  - 16 mono channels
  - 5 stereo FX/Aux channels  
  - 6 bus channels
  - 4 FX send channels
  - Main post-fader left/right
  - Monitor left/right

**Clip Indicators:** ❌ **Not documented** - No explicit clip flags mentioned in official protocol

---

### 2. Community Discussions (Behringer World Forums)

**Source:** behringer.world forum discussions

**Findings:**
- Community consensus: **No explicit clip indicators** in OSC meter data
- Common practice: Implement clip detection by **monitoring dB values**
- Suggested threshold: Values exceeding **0 dB** or approaching **-0.1 dB** indicate clipping
- Requires **empirical testing** to determine exact threshold behavior

---

### 3. Community Implementations

#### Bitfocus Companion (Behringer X-Air Module)
- **Status:** Mature integration module
- **Clip Handling:** Not specifically documented in search results
- **Note:** Would require direct code inspection to confirm implementation

#### xair-api (Python)
- **GitHub:** onyx-and-iris/xair-api-python (referenced in search)
- **Status:** Higher-level API abstraction
- **Clip Handling:** Search results indicate no explicit clip indicator support
- **Note:** Would require code review to confirm meter handling approach

#### tarsjoris/x-air
- **Status:** Community tooling (proxy-style workflow)
- **Clip Handling:** Not found in search results

---

## Technical Analysis

### Current Implementation

Our codebase already decodes `/meters/1` correctly:
- Extracts 16-bit signed integers
- Converts to dB: `raw / 256.0`
- Normalizes to 0-1 range for display

### Clip Detection Strategy

**Recommended Approach:** Local inference based on dB threshold

**Implementation Options:**

1. **Simple Threshold (0 dB)**
   - Detect when `db >= 0.0`
   - Pros: Simple, clear threshold
   - Cons: May miss near-clipping scenarios

2. **Near-Threshold (-0.1 dB)**
   - Detect when `db >= -0.1`
   - Pros: Catches near-clipping
   - Cons: May trigger on legitimate peaks

3. **Sustained Threshold**
   - Detect when `db >= threshold` for N consecutive frames
   - Pros: Reduces false positives
   - Cons: Adds latency

**Recommended:** Start with **Option 1 (0 dB threshold)** for initial implementation, as it aligns with standard digital audio clipping definition.

### Visual Format Decision

**Clip Indicator Placement:**
- Clip indicator `"!"` appears at the **END** of the meter bar (top of visual meter)
- Format when clipping: `"::::....!"` (filled bars + empty bars + clip indicator)
- Format with signal-present: `"::::•..."` (filled bars + bullet + empty bars)
- **No conflict:** Signal-present uses `•` in the middle; clip uses `!` at the END

**Rationale:**
- End of bar = top of visual meter (intuitive placement)
- Does not interfere with signal-present indicator placement
- Clear visual distinction between the two indicators

**Hold Duration:**
- 10 seconds after last clipping detection
- Auto-clears when no clipping detected for 10 seconds

---

## Implementation Plan for XD-F014

### Phase 1: Protocol Confirmation (Complete)
- ✅ Reviewed official OSC documentation
- ✅ Reviewed community sources
- ✅ Confirmed: No explicit clip flags exist

### Phase 2: Local Inference Implementation
- [ ] Add clip detection logic in bridge (`xrDock-bridge.js`)
  - Monitor decoded dB values from `/meters/1`
  - Flag clip when `db >= 0.0` (or chosen threshold)
- [ ] Add clip state to WebSocket protocol (`wsProtocol.js`)
  - Extend `fxState` and `channelState` messages with optional `clip` boolean
- [ ] Implement 10-second hold timer
  - Track clip state per channel/FX
  - Auto-clear after 10 seconds of no clipping
- [ ] Update plugin UI (`xrDock.js`)
  - Display `!` glyph at END of meter bar (top of visual meter) when clip is active
  - Format: `"::::....!"` when clipping (vs `"::::•..."` for signal-present)
  - Apply to all meter types (Channel, FX, future tiles)

### Phase 3: Empirical Testing (Optional but Recommended)
- [ ] Test with actual XR18 during intentional clipping
- [ ] Verify threshold behavior (0 dB vs -0.1 dB)
- [ ] Confirm meter value saturation behavior
- [ ] Validate hold timer behavior

---

## Key Findings

1. **No Protocol Support:** XR18 OSC does not provide clip flags
2. **Local Inference Required:** Must detect clipping from meter dB values
3. **Standard Approach:** Community uses 0 dB threshold
4. **Implementation Path:** Clear - add detection logic to existing meter decoding

---

## References

- X AIR Mixer Series Remote Control Protocol (OSC) - Official PDF
- behringer.world forum discussions
- Community implementations (Bitfocus Companion, xair-api, tarsjoris/x-air)

---

## Next Steps

1. **Proceed with local inference implementation** (Phase 2)
2. **Use 0 dB threshold** as initial approach
3. **Test empirically** if possible to validate behavior
4. **Document threshold choice** in implementation comments

