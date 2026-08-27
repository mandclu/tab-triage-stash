# Tab Triage & Stash

A Manifest V3 Chrome extension that (1) analyzes your open tabs and produces a linked, prioritized report of what to close first, and (2) lets you **stash** tabs into a bookmark folder so you reclaim memory without losing them.

## Install (unpacked)

1. Clone or download this folder.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the `tab-triage` folder.
5. Pin the extension, click its icon for the popup, or press <kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> to open the full report.

## What it does

- **Report** (`src/report/`) — ranks every open tab into **Close First / Review / Keep** bands using a category ruleset (streaming, web apps, AI/dashboards, infinite-scroll feeds, static docs) plus live signals Chrome exposes per tab: playing audio, idle time, already-asleep, pinned. Each row links back to the live tab; select rows to close or stash them in bulk.
- **Stash** — writes the selected tabs into a bookmark folder under **🗂 Stashed Tabs**, then closes them. Give the stash a name, or leave it blank to fall back to a timestamp. Reopen everything with one click from the report or popup.
- **Undo** — the last close/stash is reversible from the report.
- **Manual saved-group how-to** — the report includes a panel explaining Chrome's native "save group → close group" workflow, for when you want the colored-pill restore instead of a bookmark folder. (Chrome does not expose an API for saved groups, so this is guidance, not a button.)

## Files

```
tab-triage/
├── manifest.json          MV3 manifest, permissions, keyboard command
├── src/
│   ├── background.js       service worker: scoring, close, stash, restore, undo
│   ├── categories.js       host → category ruleset (edit to add your domains)
│   ├── scoring.js          pure scoring functions
│   ├── memoryProvider.js   estimated vs. measured memory (Dev-channel API)
│   ├── report/             the full report page
│   ├── popup/              the toolbar popup
│   └── options/            options page — editable custom ruleset (chrome.storage.local)
├── icons/
└── README.md
```

## Permissions

`tabs` (read titles/URLs and close tabs), `bookmarks` (create stash folders), `storage` (undo buffer). No host permissions and no content scripts — the extension never injects into your pages. The `tabs` permission triggers Chrome's "read your browsing history" warning; that is expected and unavoidable for a tab manager.

`tabGroups` is **not** currently requested — nothing in the extension uses it yet. It will be needed if/when the optional visual-grouping preview (grouping selected tabs in the live window before stashing them) is built; see `STEPS.md` step 4.

## Measured memory mode (optional)

By default, the report **estimates** each tab's memory impact by category plus live signals. It does **not** show exact megabytes, because standard Chrome does not let extensions read per-tab memory.

If you want the report to show **measured** RAM, run the extension on **Chrome Dev channel**, which exposes the `chrome.processes` API.

**Steps**

1. **Install Chrome Dev channel** from [google.com/chrome/dev](https://www.google.com/chrome/dev/). It installs alongside your normal Chrome (separate profile) — it does not replace it.
2. **Load the extension** in Dev channel: `chrome://extensions` → **Developer mode** → **Load unpacked** → select the `tab-triage` folder.
3. **Open the report** and click **Enable measured memory**. Approve the `processes` permission prompt.
4. **Done.** The report shows a **Measured** badge and a per-process RAM column. Load the same extension on regular Chrome and it falls back to estimated mode automatically — no error.

**Notes**

- This is gated by Chrome's release channel, not a `chrome://flags` toggle. Stable and Beta Chrome will not expose measured memory even after granting the permission.
- Figures are **per renderer process**, and Chrome shares one process across multiple same-site tabs. When tabs share a process the report marks the figure with a `⁂` and a "shared by N tabs" tooltip, so a single number is not always one tab's exclusive footprint.
- Measuring has a small cost, so numbers refresh when you open the report rather than continuously.

To ship a stable-only build, delete the `optional_permissions` entry in `manifest.json` and the **Enable measured memory** button; the extension runs identically in estimated mode.

## Customizing the ruleset

The easiest way is the **options page** — right-click the extension icon → **Options**, or open `chrome://extensions`, find Tab Triage, and click **Extension options**. Pick a category, type a host (or a comma-separated list), and click **Add rule**. Custom rules are checked *before* the built-in ruleset — first match wins — so a rule you add here can override a built-in categorization for the same host. Removing a custom rule falls back to the built-in categorization automatically. Changes apply on the next report refresh; no reload needed.

For the built-in defaults themselves, hand-edit `src/categories.js`: each rule in `RULES` maps a list of hosts to a category, the first matching rule wins, and unmatched hosts fall into `UNKNOWN`. Reload the extension from `chrome://extensions` after editing that file.
