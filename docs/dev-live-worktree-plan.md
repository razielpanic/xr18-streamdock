# Dev / live worktree split — plan

**Status:** planned, not executed
**Backlog:** XD-T014
**Origin:** discovered during the 2026-04-10 git identity cleanup session, when a `git stash` in the working tree briefly exposed Stream Dock to pre-rebrand UUIDs. No harm done, but it surfaced a class of latent hazards worth fixing before they bite.

---

## Problem

The plugin directory `~/Projects/StreamDock/com.youshriek.xr18fx.sdPlugin/` is currently symlinked into Stream Dock's plugins folder:

```
~/Library/Application Support/HotSpot/StreamDock/plugins/
  com.youshriek.xr18fx.sdPlugin  ──>  ~/Projects/StreamDock/com.youshriek.xr18fx.sdPlugin
```

This gives instant edit-to-run feedback (no copy, no build), which is the whole point. But it also means **any state on disk is live state.** Stream Dock reads the same bytes your editor is writing. Concretely, the following can all silently break production:

- Half-saved file during a refactor
- `git stash` (reverts working tree)
- `git checkout <other-branch>` (swaps working tree)
- `git rebase` / `git merge` with conflict markers left in files
- Backup directories (`.git.bak`) temporarily inside the repo

Today's stash window was ~5 minutes and nothing triggered a reload. Next time the window might land wrong.

---

## Proposed layout

Two directories, **one git repository** (via `git worktree`):

```
~/Projects/StreamDock/
  com.youshriek.xr18fx.sdPlugin/   ← dev tree  — where you edit, branch, stash freely
  xrdock-live/                     ← live tree — pinned to branch `live`, symlink target
```

Stream Dock symlink repoints to the live tree:

```
~/Library/.../Plugins/com.youshriek.xr18fx.sdPlugin  ──>  ~/Projects/StreamDock/xrdock-live
```

Both trees share the same `.git` — git worktrees don't duplicate objects. The `live` branch fast-forwards to `main` (or any tag) only when you explicitly say so. Stream Dock never sees the dev tree.

---

## How deploy works

From anywhere, one command:

```bash
git -C ~/Projects/StreamDock/xrdock-live merge --ff-only main
```

That's it. The live tree updates to whatever `main` points at. Stream Dock reads new files on its next manifest reload. No build, no copy.

## How rollback works

```bash
git -C ~/Projects/StreamDock/xrdock-live reset --hard v0.6.0
```

Or any commit SHA. Live tree flips back instantly.

## What dev feels like after

Everything in `com.youshriek.xr18fx.sdPlugin/` is still where you left it. Open it in your editor like always. Stash, branch-switch, rebase, experiment with broken code — Stream Dock doesn't care, because it's reading from `xrdock-live/`. When you're ready to ship a change, you run the one-liner above.

---

## Setup steps (for when you execute this)

Pre-flight:
1. Make sure the dev tree is on `main` and clean (`git status` empty).
2. Make sure no `xrdock` plugin is actively running under a Stream Dock session that would notice the symlink flip. Bridge process (`xrDock-bridge.js`) is fine — it's talking OSC, not reading plugin files.

Execute:
```bash
cd ~/Projects/StreamDock/com.youshriek.xr18fx.sdPlugin

# 1. Create the live branch at current HEAD
git branch live

# 2. Create the worktree sibling
git worktree add ../xrdock-live live

# 3. Verify contents are identical (should produce no diff)
diff -rq . ../xrdock-live | grep -v "^Only in \./\.git" || echo "identical"

# 4. Repoint the Stream Dock symlink (back-to-back, no window)
PLUGINS="$HOME/Library/Application Support/HotSpot/StreamDock/plugins"
rm "$PLUGINS/com.youshriek.xr18fx.sdPlugin" && \
  ln -s "$HOME/Projects/StreamDock/xrdock-live" "$PLUGINS/com.youshriek.xr18fx.sdPlugin"

# 5. Verify the symlink resolves and manifest still reads
ls -la "$PLUGINS/com.youshriek.xr18fx.sdPlugin"
head -5 "$PLUGINS/com.youshriek.xr18fx.sdPlugin/manifest.json"

# 6. Push the live branch to origin (nice record of "what's deployed")
git push -u origin live
```

Post-flight:
- `git worktree list` should show both trees.
- Bridge process keeps running through all of this (it doesn't read manifest.json).
- Next time Stream Dock loads the plugin, it'll follow the new symlink and read identical bytes from the new path. Zero observable change.

---

## Things to remember after setup

- **Your muscle memory stays intact.** You still open `com.youshriek.xr18fx.sdPlugin/` in your editor. That path is the dev tree.
- **`xrdock-live/` is not for editing.** Treat it like a read-only deploy target. If you need to look at what's currently live: `git -C xrdock-live log -1`.
- **"Deploy" is a git merge, not a file copy.** The one-liner is the deploy. Add it as a shell alias if you want: `alias xrdock-deploy='git -C ~/Projects/StreamDock/xrdock-live merge --ff-only main'`.
- **Rollback is a git reset on the live tree.** Dev tree is unaffected.
- **The other Mac (if kept)** needs `git fetch && git checkout live` if you ever want to inspect deploy state from there. Not required for development.

---

## Why not other options

- **Keep the single tree + just be careful.** Fragile. Today proved the risk is real. Human discipline fails under deadline pressure.
- **Rsync / file-watcher deploy.** Loses the zero-latency property you explicitly value. Adds a moving part (the watcher).
- **Two full clones.** Doubles the `.git` footprint for no reason. Worktrees give the same isolation without the duplication.
