# AGENTS.md — Context for anyone (human or AI) working on this repo

This file is the living summary. `tab-triage-extension-plan.md` and `Chrome Tabs.md` are the
original design/research documents — read them for the full reasoning, but treat *this* file as
the source of truth for current state, constraints, and conventions, since the implementation
has moved on from the plan in some places. If something here and in the plan disagree, this
file wins.

For what's built vs. not, see `STEPS.md`. For how to verify behavior by hand, see `QA.md`.

---

## What this is

A Manifest V3 Chrome extension with two jobs:

1. **Analyze** every open tab and produce a linked, prioritized report of what to close first
   (heavy categories, actively playing audio, long-idle) — `src/report/`.
2. **Stash** the offenders into a bookmark folder so the tabs close and free memory without
   being lost — `src/background.js` stash/restore logic.

Everything runs client-side. No server, no network calls, no `host_permissions`, no content
scripts. It never reads or injects into page content — only `chrome.tabs`/`chrome.bookmarks`
metadata (title, url, audible, discarded, pinned, lastAccessed).

## The constraint that shapes everything

**Chrome does not give extensions a reliable, per-tab memory number on stable Chrome.** The
only API that reports real memory (`chrome.processes`) exists **only on Dev channel**. Do not
try to "fix" this by finding another API — there isn't one. This is why:

- Tabs are ranked by an **ordinal heuristic score** (category weight + live signals), not
  megabytes, by default.
- The report always labels this "estimated," never invents a number.
- `src/memoryProvider.js` exists specifically to isolate the one place that *can* show real
  bytes, gated behind an optional permission and a runtime feature-detect, so the rest of the
  app (`background.js`, `report.js`) is agnostic to which mode it's in — branch only on
  `provider.mode`, never on `chrome.processes` directly outside that file.

**Chrome also does not expose an API to create a native "saved" tab group** (the colored pill
on the bookmarks bar). `chrome.tabGroups`/`chrome.tabs.group` can group/color/name tabs *in the
current session*, but cannot toggle "Save group," and `chrome.tabGroups.update()` is known to
fail outright on an already-saved group. Do not attempt to drive this via the UI or work around
the bug — it's out of scope. This is why Phase 2 (stash) is built on **bookmarks**, which give
full, stable, scriptable control and *are* persistence by definition. The saved-group workflow
is documented for the user as manual instructions (the help panel in `report.html`), not
automated.

If a task ever seems to require either of these, stop and re-read this section before writing
code around it.

## Architecture

```
manifest.json              MV3 manifest — permissions, service worker, popup, keyboard command
src/
  background.js             service worker: message router, scoring pipeline, close/stash/undo/restore
  categories.js              host → category ruleset (pure, no Chrome API)
  scoring.js                 TabRecord → priority score/band (pure, no Chrome API)
  memoryProvider.js           estimated vs. measured memory, feature-detected
  report/                    full report page (report.html/js/css) — the primary UI
  popup/                     toolbar popup — compact summary + quick actions
icons/
```

The service worker (`background.js`) is the **single source of truth for actions**. The report
and popup are thin views: they send a typed message, get a typed response, re-render. Neither
view talks to `chrome.tabs`/`chrome.bookmarks` directly except where a user gesture is required
in-page (see `memoryProvider.js`'s `requestMeasuredMemory`, which must run in an extension page,
not the service worker, so the permission prompt has a valid gesture context).

### Message protocol (all views → background.js, via `chrome.runtime.sendMessage`)

Every message is `{ type, ...payload }`; every response is `{ ok: true, data }` or
`{ ok: false, error }`. Add new actions here as new `case`s in `background.js`'s `handle()`
switch — don't invent a second channel.

| type | payload | returns |
|---|---|---|
| `GET_SCORED_TABS` | — | `{ mode, tabs: TabRecord[] }` |
| `FOCUS_TAB` | `tabId` | `{ ok: true }` |
| `CLOSE_TABS` | `tabIds[]` | `{ closed }` — silently drops ids that no longer resolve to a live tab rather than failing the whole batch |
| `FIND_STASH_FOLDER` | `name` | `{ id, title, count } \| null` — exact-title lookup scoped to the stash root; used to offer "add to existing" before creating a same-named duplicate |
| `STASH_TABS` | `tabIds[], name?, targetFolderId?` | `{ folderId, count, title }` — when `targetFolderId` is given, adds to that existing folder instead of creating a new one |
| `LIST_STASHES` | — | `[{ id, title, count, dateAdded }]` |
| `RESTORE_STASH` | `folderId` | `{ restored }` |
| `UNDO_LAST` | — | `{ restored }` |

### The report's client-side filter

`report.js` keeps `allTabs` (the full `GET_SCORED_TABS` result) and `visibleTabs` (`allTabs`
after the text filter) as module state. The filter is a pure client-side "contains" match over
title/host/categoryLabel/url/reasons — no new message type, no re-fetch. Every render path
(`renderBands`, band/category "Select all", the toolbar's "Select all shown") reads from
`visibleTabs`, so selection and bulk actions are always scoped to what's currently filtered into
view. Keep new bulk actions wired the same way — against `visibleTabs`, not `allTabs` — or a
filtered-out row becomes selectable without being visible.

### The shared confirm-modal pattern

Both `report.js` and `popup.js` define a small `confirmChoice(message, choices)` helper (a
`<div id="modal-backdrop">`/`#modal-message`/`#modal-actions` in each page's HTML) that resolves
a Promise with the clicked choice's `key`, or `null` on backdrop-click/Escape. It's intentionally
duplicated per view rather than shared as an import, matching this codebase's existing
convention of small per-view duplication (`toast()`, `escapeHtml()`) over a shared-utils module.
The stash-conflict flow (`resolveStashTarget`, also duplicated in both views) is built on it:
`FIND_STASH_FOLDER` first, then this modal if a same-named folder exists, offering
add-to-existing / create-new / cancel.

### TabRecord shape (what `GET_SCORED_TABS` returns per tab)

```
{ id, windowId, title, url, favIconUrl, host, category, categoryLabel,
  audible, discarded, pinned, ageMin, score, band, bytes, sharedWith, reasons[] }
```

`band` is one of `"close-first" | "review" | "keep"`. `bytes`/`sharedWith` are `null`/`0` in
estimated mode.

## The scoring system

`categories.js` maps a host to a category with an **ordinal weight** (higher = close sooner,
not a megabyte figure). `scoring.js` starts from that weight and nudges it with live signals
Chrome genuinely exposes on stable channel: `discarded` (already asleep → deprioritize hard),
`audible` (real live load → prioritize), idle time via `lastAccessed` (staler → safer to close),
`pinned` (deliberate → protect). Band thresholds: `close-first` ≥ 90, `review` ≥ 60, else
`keep`.

Both files are pure functions — no `chrome.*` calls, no I/O. Keep them that way; it's what
makes them unit-testable without a browser (see `STEPS.md` step 1). If a change needs a
Chrome API, it belongs in `background.js`, which calls these as a pipeline.

The ruleset (`RULES` in `categories.js`) directly encodes the categories from `Chrome Tabs.md`:
Media & Live Streaming, Complex Web Apps, AI Chat & Dashboards, Infinite Scroll Feeds, Static
Articles & Docs, and an `UNKNOWN` fallback. First matching rule wins; hosts match exact or as a
suffix (`docs.google.com` matches `foo.docs.google.com`).

## Conventions

- **Durable state lives in `chrome.storage.local`, never module-level variables**, because MV3
  can evict the service worker at any time and a torn-down worker restarts with memory wiped.
  The undo buffer and last-stash handle already follow this — keep new stateful features doing
  the same.
- **Write before you destroy.** Stash always creates the bookmark(s) *before* calling
  `chrome.tabs.remove`, so a crash mid-stash can never lose a URL. Apply the same ordering to
  any new destructive action.
- **Minimal permissions.** Current set: `tabs`, `tabGroups`, `bookmarks`, `storage`, plus
  optional `processes`. No `host_permissions`, no content scripts — don't add either without a
  strong reason; it's both a privacy property and what keeps the install-time permission prompt
  low-friction. (Note: `tabGroups` is currently unused — see `STEPS.md` step 4 for the pending
  decision to either remove it or implement the feature that justifies it.)
- **Never fabricate a memory number.** Estimated mode ranks and labels; it does not display
  megabytes. Only `memoryProvider.js`'s `RealMemoryProvider` (Dev channel + granted permission)
  may surface bytes, and even then, `sharedWith` must accompany any figure so the UI doesn't
  imply an exclusive footprint for a shared process.
- **Idempotent messages.** Actions should tolerate being replayed against already-closed tabs or
  already-restored stashes without throwing — the worker restarting mid-flow is a normal MV3
  event, not an edge case.

## Working in this repo

- Load unpacked via `chrome://extensions` → Developer mode → Load unpacked → select this
  folder. Reload from that page after any source change (service workers aren't hot-reloaded).
- `npm run zip` packages a release zip (once `STEPS.md` step 1 lands, `npm test` runs the unit
  suite for `scoring.js`/`categories.js`).
- Before treating either of the two hard Chrome limitations above as a bug to fix, re-read
  "The constraint that shapes everything."
- Check `STEPS.md` before starting new work — it tracks what's left and why, with acceptance
  criteria per item. Update its checkbox when a step is actually done (tests passing / criteria
  met), not when code is merely written.
