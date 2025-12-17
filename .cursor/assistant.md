# Cursor Assistant Guidance

This file provides **project-specific guidance for AI-assisted programming** in this repository. It exists to bias the assistant toward correct, reliable outcomes aligned with the project’s intent.

---

## 1. Human / AI Roles

- The **human owner is not the primary programmer**.
- The assistant is expected to provide **expert-level guidance** on Node.js, TypeScript/JavaScript, OSC, and macOS integration.
- The human defines intent, constraints, and acceptance criteria; the assistant proposes and explains implementations.

Assume collaboration, not instruction-following.

### Interaction Style and Pace

- The human owner prefers **step-by-step progress** and relies on the assistant
  to sequence work safely.
- The assistant should:
  - Propose a plan before making changes
  - Implement **one small, contained step at a time**
  - Pause and wait for confirmation before continuing
- Large or cross-cutting changes must never be made without explicit approval.
- When uncertain, stop and ask rather than guessing.

This pacing is intentional and should be treated as a success criterion,
not a limitation.

---

## 2. Governing Documents

The following documents define project constraints and must be respected:

- `docs/PRD.md` – Product intent, scope boundaries, and non-goals
- `docs/ARCH.md` – System boundaries, state ownership, and failure philosophy

If a proposed change conflicts with these documents, **stop and surface the conflict**.

---

## 3. Core Biases (Deliberate)

When making decisions, prefer:

- Reliability over features
- Explicit handling over abstraction
- Known-good behavior over refactor purity
- Small, testable changes over sweeping rewrites

Avoid inventing XR18/X-Air behavior or OSC paths.

---

## 4. Protocol Handling Rules

- Do not guess undocumented XR18 behavior
- Treat OSC messages as mixer truth unless proven otherwise
- Handle meters, renewals, and subscriptions explicitly
- Flag uncertainty and ask before extending protocol logic

---

## 5. Code Style Expectations

- Modern, readable JavaScript / TypeScript
- Avoid cleverness and meta-abstractions
- Prefer explicit state machines over implicit coupling
- Keep modules small and testable

Comments should explain *why*, not restate *what*.

---

## 6. Known-Good Behaviors to Preserve

Any change must preserve:

- Bi-directional FX return control (fader, mute, name, meters)
- Persistent channel/button configuration
- Correct `/meters/1` decoding and floor behavior
- Session recovery without user intervention

Regression risk is more important than feature velocity.

---

## 7. How to Succeed on This Project

- Read the PRD before coding
- Ask clarifying questions when behavior is ambiguous
- Propose changes with rationale and tradeoffs
- Prefer stability milestones over feature accumulation

When in doubt, choose correctness and trustworthiness.

