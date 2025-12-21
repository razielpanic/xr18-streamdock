

# Debugging VSD Craft UI and Runtime

This document describes the **authoritative debugging interfaces and workflows** for the VSD Craft / Stream Dock environment used by this project.

It intentionally documents *facts and constraints*, not speculative capabilities.

---

## Overview

VSD Craft renders plugin UI using an **embedded Chromium runtime** (CEF-style). When debugging is enabled, VSD Craft exposes a **Chromium DevTools Remote Debugging endpoint** on `localhost`.

This endpoint provides full Chrome DevTools access to the running UI process, including console output, loaded scripts, DOM state, and limited network visibility.

This is **not** a VSD-specific debugger. It is the standard Chrome DevTools frontend speaking the **Chrome DevTools Protocol (CDP)**.

---

## DevTools Endpoint

Typical form:

```
http://127.0.0.1:23519/devtools/inspector.html?ws=127.0.0.1:23519/devtools/page/<PAGE_ID>
```

Notes:
- Port (`23519`) is assigned by VSD Craft.
- `<PAGE_ID>` is generated per running UI instance.
- The endpoint is only accessible from the local machine.

Authoritative references:
- Chrome DevTools Protocol: https://chromedevtools.github.io/devtools-protocol/
- Chrome remote debugging: https://developer.chrome.com/docs/devtools/remote-debugging/

---

## Capabilities

Using this DevTools endpoint, a developer can:

- View **Console** output (`console.log`, warnings, uncaught errors)
- Inspect **loaded JavaScript bundles** and sourcemaps (if present)
- Inspect the **DOM and CSS** of the plugin UI
- Observe **network requests** initiated by the UI (limited visibility)
- Capture **runtime state at the moment of failure**

This is the **primary and preferred** method for debugging UI/runtime issues beyond ad-hoc logging.

---

## Hard Constraints

The following constraints are fundamental:

- The DevTools endpoint is bound to `localhost`.
- LLMs do not independently initiate or maintain connections to this endpoint; they reason over runtime evidence (e.g. terminal output, logs, traces) explicitly surfaced by the developer.
- No remote or automated inspection is possible without explicit artifact extraction.

These constraints are architectural and non-negotiable.

---

## Human-in-the-Loop Workflow (Required)

Debugging is expected to follow this model:

1. Developer opens DevTools via the exposed endpoint.
2. Issue is reproduced with DevTools open.
3. Evidence is collected:
   - Console output
   - Error stacks
   - Network failures
   - Relevant source snippets
4. Evidence is pasted verbatim into Cursor / ChatGPT for analysis.

LLMs act as **analysis and synthesis engines**, not live debuggers.

---

## What to Capture for Analysis

When reporting an issue, include:

- Exact console messages (no paraphrasing)
- The user action that triggered the issue
- Expected behavior vs observed behavior
- Whether the issue is deterministic or intermittent

Screenshots are acceptable, but raw text is preferred.

---

## Relationship to Architecture

The existence of this DevTools endpoint implies:

- UI behavior is governed by Chromium runtime semantics
- Rendering, timing, and lifecycle bugs should be reasoned about using web-runtime models
- Console silence does **not** imply correctness

See `docs/ARCH.md` for architectural context.

---

## Non-Goals

This document does not:
- Describe VSD SDK APIs
- Guarantee DevTools availability in all release builds
- Provide automation or scripting instructions for CDP

Those topics are explicitly out of scope.