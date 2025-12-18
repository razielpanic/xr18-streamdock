# VSDinside Plugin SDK (Reference)

Source:
- https://github.com/VSDinside/VSDinside-Plugin-SDK
- https://sdk.key123.vip/en/guide/events-received.html

Purpose:
- Reference-only documentation for Stream Dock plugin event model.
- Used to verify event names and payload semantics.
- Not an implementation guide.

---

## Received Events (Authoritative)

The plugin may receive the following interaction events from the host.

### Key (Tile) Events

- **keyDown**  
  Event received when a user presses a key (tile).

- **keyUp**  
  Event received when a user releases a key (tile).

A “screen tap” on a tile is delivered as a `keyDown` / `keyUp` pair.  
There is no separate tap or touch event.

### Knob (Dial) Events

- **dialDown**  
  Event received when a user presses a knob.

- **dialUp**  
  Event received when a user releases a pressed knob.

- **dialRotate**  
  Event received when a user rotates a knob.

Payload fields include:
- `ticks` — signed integer; positive = clockwise, negative = counter-clockwise
- `pressed` — boolean indicating whether the knob was pressed during rotation

---

## Notes

- Coordinates may be present in payloads but do not change event semantics.
- Stream Dock uses **Knob** terminology (not Encoder).
- Do not assume undocumented events exist.