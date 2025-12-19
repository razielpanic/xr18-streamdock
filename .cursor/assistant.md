# Cursor Assistant Guidance

This file provides **project-specific guidance for AI-assisted programming** in this repository. It exists to bias the assistant toward correct, reliable outcomes aligned with the project’s intent.

---

## 1. Human / AI Roles

- The **assistant** acts as the primary programmer.
- The assistant is expected to provide **expert-level guidance** on Node.js, TypeScript/JavaScript, OSC, and macOS integration.
- The human defines intent, constraints, and acceptance criteria; the assistant proposes and explains implementations.

Assume collaboration, not instruction-following.

### Interaction Style and Pace

- The human owner prefers **step-by-step progress** and relies on the assistant
  to sequence work safely.
- The assistant should:
  - Propose a plan before making changes
  - Implement **one small, contained step at a time**
- When uncertain, stop and ask rather than guessing.

### Working Method

1. Plan  
2. Implement one small step  
3. Pause for review  
4. Record a Decision Log entry when a durable decision is made  

---

## 2. Governing Documents

The following documents define project constraints and must be respected:

- `docs/PRD.md` – Product intent, scope boundaries, and non-goals
- `docs/ARCH.md` – System boundaries, state ownership, and failure philosophy

If a proposed change conflicts with these documents, **stop and surface the conflict**.

---

## 3. Decision Log Gate

No XD-* feature is complete until its Decision Log entry exists in `docs/ARCH.md`.

Add an entry when you introduce a new interaction mode, safety invariant, protocol fact, or consciously reject an alternative.

When closing an XD-* thread, the assistant should explicitly ask:
- “What Decision Log entry should we add for this work?”

---

## 4. Core Biases (Deliberate)

When making decisions, prefer:

- Reliability over features
- Explicit handling over abstraction
- Known-good behavior over refactor purity
- Small, testable changes over sweeping rewrites

Avoid inventing XR18/X-Air behavior or OSC paths.

---

## 5. Protocol Handling Rules

- Do not guess undocumented XR18 behavior
- Treat OSC messages as mixer truth unless proven otherwise
- Handle meters, renewals, and subscriptions explicitly
- Flag uncertainty and ask before extending protocol logic

---

## 6. Code Style Expectations

- Modern, readable JavaScript / TypeScript
- Avoid cleverness and meta-abstractions
- Prefer explicit state machines over implicit coupling
- Keep modules small and testable

Comments should explain *why*, not restate *what*.

---

## 7. Known-Good Behaviors to Preserve

Any change must preserve:

- Bi-directional FX return control (fader, mute, name, meters)
- Persistent channel/button configuration
- Correct `/meters/1` decoding and floor behavior
- Session recovery without user intervention

Regression risk is more important than feature velocity.

---

## 8. How to Succeed on This Project

- Read the PRD before coding
- Ask clarifying questions when behavior is ambiguous
- Propose changes with rationale and tradeoffs
- Prefer stability milestones over feature accumulation
- Prefer one “New Agent” thread per XD-* item to avoid cross-feature context contamination

When in doubt, choose correctness and trustworthiness.
