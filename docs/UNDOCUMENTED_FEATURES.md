# Undocumented Features in Stream Dock SDK

This document catalogues features discovered in the Mirabox StreamDock Plugin SDK that may be undocumented or under-documented, specifically related to distinguishing screen taps vs knob presses and Touch Bar-style "Information" controller mode.

---

## 1. touchTap Event - Distinguishing Screen Taps from Button Presses

### Discovery
The SDK defines a separate `touchTap` event that distinguishes screen taps from button presses (`keyDown`/`keyUp`).

### Evidence

**C++ SDK (HSDSDKDefines.h):**
```cpp
#define kESDSDKEventTouchTap "touchTap"
```

**Qt SDK (SDKDefines.h):**
```cpp
#define mSDKEventTouchTap "touchTap"
```

**Vue/TypeScript SDK (_streamdock.d.ts):**
```typescript
type keyDownUpTouchTap = {
  action: string;
  event: string;
  context: string;
  device: string;
  payload: {
    settings: {};
    coordinates: {
      column: number;
      row: number;
    };
    state: number;
    userDesiredState: number;
    isInMultiAction: boolean;
  };
};

// Action-level handlers
touchTap?(this: ActionMessage, data: EventPayload.keyDownUpTouchTap): void;
```

**Documentation mentions (readme.md):**
```
keyDown/keyUp/touchTap triggers when pressed/released/touched
```

### Usage Pattern

For actions that support both button presses and screen taps, you would handle them separately:

```javascript
plugin.action1 = new Actions({
  // Button press/release
  keyDown(data) {
    console.log("Button pressed");
  },
  keyUp(data) {
    console.log("Button released");
  },
  // Screen tap (separate event!)
  touchTap(data) {
    console.log("Screen tapped", data.payload.coordinates);
  }
});
```

### Implications
- `keyDown`/`keyUp` = Physical button presses on keys/keypads
- `touchTap` = Screen taps on touch-enabled displays (like Stream Deck Plus)
- For knob controllers: `dialDown`/`dialUp` are separate from `touchTap`
- This allows distinguishing between rotating a knob vs tapping its screen

---

## 2. Information Controller - Touch Bar Style Mode

### Discovery
The SDK supports an "Information" controller type that appears to be a Touch Bar-style continuous display with pixel-accurate touch coordinates.

### Evidence

**Manifest Examples:**
```json
{
  "Actions": [{
    "Controllers": [
      "Keypad",
      "Information",  // <-- Touch Bar style controller!
      "Knob"
    ]
  }]
}
```

Found in:
- `SDJavaScriptSDK/com.mirabox.streamdock.xxx.sdPlugin/manifest.json`
- `SDPythonSDK/com.mirabox.streamdock.time.sdPlugin/manifest.json`
- `SDNodeJsSDK/com.mirabox.streamdock.demo.sdPlugin/manifest.json`
- `SDVueSDK/vue/src/manifest.cjs`

### Plugin-Level Coordinate Events

**Vue/TypeScript SDK defines special plugin-level events for Information controller:**

```typescript
type keyUpCord = {
  event: string;
  device: string;
  // Note: NO action/context - this is plugin-level!
  payload: {
    coordinates: {
      x: number;  // Pixel X coordinate
      y: number;  // Pixel Y coordinate
    };
    size: {
      width: number;   // Display width in pixels
      height: number;  // Display height in pixels
    }
  };
  isInMultiAction: boolean;
};

// Plugin-level handlers (not action-level!)
type PluginMessage = {
  keyUpCord?(this: PluginMessage, data: EventPayload.keyUpCord): void;
  keyDownCord?(this: PluginMessage, data: EventPayload.keyUpCord): void;
};
```

**Implementation example (vue/src/plugin/index.vue):**
```typescript
useWatchEvent('plugin', {
  keyUpCord(data) {
    plugin.eventEmitter.emit("keyUpCord", data);
  },
  keyDownCord(data) {
    plugin.eventEmitter.emit("keyDownCord", data);
  },
});
```

### Key Differences from Normal Actions

1. **Plugin-Level Events**: `keyDownCord`/`keyUpCord` are plugin-level, not action-level
2. **Pixel Coordinates**: Uses `x, y` pixel coordinates instead of `column, row` grid coordinates
3. **No Context**: No `action` or `context` fields - the entire Information display is one continuous touch surface
4. **Size Information**: Includes display dimensions in the payload

### Additional Methods for Information Controller

**setText method (Qt SDK defines):**
```cpp
#define mSDKEventSetText "setText"
```

**setFeedback method (both C++ and Qt SDKs):**
```cpp
#define mSDKEventSetFeedback "setFeedback"
```

These methods may be specific to Information controller for displaying text/feedback on the continuous display.

---

## 3. Event Summary

### Action-Level Events (Per Action Instance)

| Event | Description | When Used |
|-------|-------------|-----------|
| `keyDown` | Physical button pressed | Keypad/button presses |
| `keyUp` | Physical button released | Keypad/button releases |
| `touchTap` | Screen tapped | Touch-enabled displays (separate from button) |
| `dialDown` | Knob pressed | Knob controller physical press |
| `dialUp` | Knob released | Knob controller physical release |
| `dialRotate` | Knob rotated | Knob controller rotation |

### Plugin-Level Events (Global, No Context)

| Event | Description | Controller Type |
|-------|-------------|-----------------|
| `keyDownCord` | Touch at pixel coordinates | Information (Touch Bar) |
| `keyUpCord` | Touch released at pixel coordinates | Information (Touch Bar) |

**Note**: `keyDownCord`/`keyUpCord` are plugin-level events, meaning they fire regardless of which action instance (if any) is on screen. The Information controller appears to be a global display surface.

---

## 4. Distinguishing Screen Taps from Knob Presses

### For Knob Controllers with Touch Screens

If a knob action supports both physical knob interaction and screen taps:

```javascript
plugin.knobAction = new Actions({
  // Physical knob rotation
  dialRotate(data) {
    console.log("Knob rotated", data.payload.ticks);
  },
  // Physical knob press (pushing down on knob)
  dialDown(data) {
    console.log("Knob pressed down");
  },
  dialUp(data) {
    console.log("Knob released");
  },
  // Screen tap (tapping the knob's touch screen)
  touchTap(data) {
    console.log("Knob screen tapped", data.payload.coordinates);
  }
});
```

### Event Flow Example

**Scenario**: User taps the screen of a knob controller
1. `touchTap` event fires with coordinates
2. `dialDown` does NOT fire (physical knob wasn't pressed)
3. `dialUp` does NOT fire

**Scenario**: User presses down on the physical knob
1. `dialDown` event fires
2. `dialUp` fires when released
3. `touchTap` does NOT fire

This allows completely separate handling of touch vs physical interaction.

---

## 5. Information Controller Usage Pattern

### Manifest Configuration

```json
{
  "Actions": [{
    "UUID": "com.example.touchbar",
    "Name": "Touch Bar Action",
    "Controllers": ["Information"],  // Only Information controller
    "States": [{
      "Image": "static/touchbar-bg.png"
    }]
  }]
}
```

### Plugin Implementation

```javascript
// Plugin-level handler (not action-level!)
plugin.keyDownCord = (data) => {
  const { x, y } = data.payload.coordinates;
  const { width, height } = data.payload.size;
  
  // Calculate which "zone" or "button" was tapped based on pixel coordinates
  const normalizedX = x / width;
  const normalizedY = y / height;
  
  if (normalizedX < 0.33) {
    // Left third tapped
  } else if (normalizedX < 0.67) {
    // Middle third tapped
  } else {
    // Right third tapped
  }
};

plugin.keyUpCord = (data) => {
  // Handle touch release
};
```

### Differences from Normal Actions

- **No Action Context**: Events fire at plugin level, not per-action-instance
- **Pixel Coordinates**: Continuous coordinate space, not discrete grid
- **Global Display**: The Information controller appears to be a single continuous display surface
- **Layout Control**: You manually calculate "zones" based on pixel coordinates

---

## 6. Testing Recommendations

### Testing touchTap vs dialDown/dialUp

1. Add `touchTap` handler to a knob action
2. Tap the screen without pressing the knob
3. Verify `touchTap` fires but `dialDown`/`dialUp` do not
4. Press the physical knob
5. Verify `dialDown`/`dialUp` fire but `touchTap` does not

### Testing Information Controller

1. Create an action with `"Controllers": ["Information"]` only
2. Add plugin-level `keyDownCord` and `keyUpCord` handlers
3. Touch the Information display at various points
4. Log the `x, y` coordinates and `width, height` size
5. Map pixel coordinates to your UI zones

---

## 7. References

### SDK Source Files

- C++ SDK: `StreamDockCPPSDK/StreamDockCPPSDK/StreamDockSDK/HSDSDKDefines.h`
  - Line 49: `#define kESDSDKEventTouchTap "touchTap"`
  - Line 69: `#define kESDSDKEventSetFeedback "setFeedback"`

- Qt SDK: `SDQtSDK/SDK/SDKDefines.h`
  - Line 34: `#define mSDKEventTouchTap "touchTap"`
  - Line 53-54: `setFeedback`, `setText`

- Vue/TypeScript SDK: `SDVueSDK/vue/src/types/_streamdock.d.ts`
  - Lines 68-84: `keyUpCord` type definition with pixel coordinates
  - Lines 94-109: `keyDownUpTouchTap` type definition
  - Lines 276-278: Action-level `touchTap` handler
  - Lines 302-303: Plugin-level `keyDownCord`/`keyUpCord` handlers

- Documentation: Various `readme.md` files mention "keyDown/keyUp/touchTap"

### Manifest Examples

- `SDJavaScriptSDK/com.mirabox.streamdock.xxx.sdPlugin/manifest.json` - Shows `"Information"` in Controllers array
- `SDPythonSDK/com.mirabox.streamdock.time.sdPlugin/manifest.json` - Shows `"Information"` controller

---

## 8. Open Questions

1. **setText method**: What is the full payload structure? How is it used with Information controller?

2. **setFeedback method**: What feedback can be set? Is this for haptic feedback or visual feedback?

3. **Information controller display**: How do you set images/text for the Information controller? Is it different from normal actions?

4. **Information controller size**: How is the size determined? Is it device-specific or configurable?

5. **touchTap on Information**: Can Information controller also receive `touchTap` events, or only `keyDownCord`/`keyUpCord`?

6. **Multiple controllers**: What happens if an action supports both `["Information", "Knob"]`? Do both event types fire?

---

## 9. Integration Notes for XR18 Plugin

### Current State
The XR18 plugin currently uses:
- `dialRotate` for knob rotation
- `dialDown`/`dialUp` for knob presses
- `keyDown` for screen taps (may be conflating with knob presses)

### Potential Improvements

1. **Add touchTap handler** to distinguish screen taps from knob presses:
   ```javascript
   // In handleFxKeyDown, could be screen tap
   // Add separate touchTap handler
   case "touchTap":
     if (actionUUID === "com.youshriek.xr18fx") {
       handleFxTouchTap(msg);
     }
     break;
   ```

2. **Information controller exploration**: Consider if any XR18 controls would benefit from Touch Bar-style continuous display (e.g., meter visualization, fader control)

3. **Event routing**: Update event switch statement to handle `touchTap` separately from `keyDown`/`dialDown`

---

## Conclusion

The Mirabox SDK supports:
- ✅ **touchTap event** for distinguishing screen taps from button/knob presses
- ✅ **Information controller** for Touch Bar-style continuous display with pixel coordinates
- ✅ **Plugin-level coordinate events** (`keyDownCord`/`keyUpCord`) for Information controller
- ✅ Additional methods (`setText`, `setFeedback`) that may be Information controller-specific

These features are present in the SDK code but may not be fully documented in user-facing documentation.


