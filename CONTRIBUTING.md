# Contributing

This is a **personal project** with explicit design constraints. The purpose of this file is to orient anyone (human or AI) before making changes.

---

## How to Read This Project

Before modifying code, read these documents **in order**:

1. `docs/PRD.md`  
   Defines *why* the project exists, its scope boundaries, and non-goals.

2. `docs/ARCH.md`  
   Defines system boundaries, state ownership, data flow, and failure philosophy.

3. `.cursor/*` (Cursor Assistant Guidance)  
   Defines how AI-assisted programming should behave on this project.

If a proposed change conflicts with any of the above, **stop and surface the conflict** rather than working around it.

---

## Project Posture

- This project prioritizes **reliability, trust, and explicit behavior** over feature growth.
- The XR18 mixer is the **single source of truth**.
- Abstraction is avoided unless it demonstrably improves correctness.

---

## Change Expectations

- Prefer small, explicit, testable changes
- Preserve known-good behaviors
- Do not invent undocumented XR18/X-Air behavior
- When uncertain, ask before proceeding

This project succeeds by staying correct and understandable, not by growing quickly.

