# Privacy Policy — Tab Triage & Stash

_Last updated: 2026-08-27_

## Summary

Tab Triage & Stash runs entirely on your device. It does not have a
server, does not make network requests, and does not send, sell, or
share any data with the developer or any third party. Everything the
extension reads or writes stays inside your own Chrome profile.

## What the extension accesses, and why

| Permission | What it's used for |
|---|---|
| `tabs` | Read each open tab's title, URL, audio/pinned/discarded state, and age, to score and categorize it in the report. Also used to close, focus, or reopen tabs you act on. |
| `bookmarks` | Create a "🗂 Stashed Tabs" bookmark folder and entries when you stash tabs, and read that folder back to list/restore your stashes. |
| `storage` | Store your custom categorization rules and a short-lived "undo" buffer (the URLs of tabs you just closed, so Undo can reopen them) locally via `chrome.storage.local`. |
| `processes` (optional, Dev channel only) | If you explicitly enable it, reads per-tab process memory usage from Chrome's Dev-channel-only `chrome.processes` API to replace estimated memory scores with measured ones. Not requested or used unless you turn it on, and unavailable outside Chrome Dev channel. |

## What leaves your device

Nothing. The extension has no backend, no analytics, no crash reporting,
and no third-party libraries that phone home. Tab titles, URLs, bookmark
data, and custom rules are read and written only through Chrome's local
extension APIs (`chrome.tabs`, `chrome.bookmarks`, `chrome.storage.local`,
`chrome.processes`) and never transmitted anywhere.

## Data retention

- The undo buffer is overwritten on every close/stash action and cleared
  once you use Undo (or leave it until the next action replaces it).
- Custom rules and stash bookmark folders persist until you remove them
  yourself, via the options page or your bookmarks manager.
- Uninstalling the extension removes its `storage.local` data. Bookmark
  folders it created are ordinary bookmarks and are not removed
  automatically — delete them yourself if you don't want to keep them.

## Contact

Questions about this policy: https://github.com/mandclu/tab-triage-stash/issues.
