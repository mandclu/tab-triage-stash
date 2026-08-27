// background.js — MV3 service worker.
// Single source of truth for actions. Durable state (undo buffer) lives in
// chrome.storage so an evicted worker can restart without losing it.

import { scoreTab } from "./scoring.js";
import { CATEGORIES } from "./categories.js";
import { getMemoryProvider } from "./memoryProvider.js";

const UNDO_KEY = "undoBuffer";
const STASH_ROOT = "🗂 Stashed Tabs"; // "🗂 Stashed Tabs"

// ---- Message router -------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
  return true; // keep the channel open for async response
});

async function handle(msg) {
  switch (msg.type) {
    case "GET_SCORED_TABS": return getScoredTabs();
    case "FOCUS_TAB":       return focusTab(msg.tabId);
    case "CLOSE_TABS":      return closeTabs(msg.tabIds);
    case "STASH_TABS":      return stashTabs(msg.tabIds, msg.name);
    case "LIST_STASHES":    return listStashes();
    case "RESTORE_STASH":   return restoreStash(msg.folderId);
    case "UNDO_LAST":       return undoLast();
    default: throw new Error("Unknown message type: " + msg.type);
  }
}

// Open the report page from the keyboard command.
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === "open_report") openReport();
});

function openReport() {
  return chrome.tabs.create({ url: chrome.runtime.getURL("src/report/report.html") });
}

// ---- Phase 1: analyze -----------------------------------------------------

async function getScoredTabs() {
  const tabs = await chrome.tabs.query({ windowType: "normal" });
  const now = Date.now();

  const provider = getMemoryProvider();
  const mem = await provider.forTabs(tabs);
  const memById = Object.fromEntries(mem.map((m) => [m.tabId, m]));

  const scored = tabs.map((t) => {
    const s = scoreTab(t, now);
    const m = memById[t.id] || {};
    return {
      id: t.id,
      windowId: t.windowId,
      title: t.title || t.url || "(untitled)",
      url: t.url || "",
      favIconUrl: t.favIconUrl || "",
      host: s.host,
      category: s.cat,
      categoryLabel: CATEGORIES[s.cat].label,
      audible: !!t.audible,
      discarded: !!t.discarded,
      pinned: !!t.pinned,
      ageMin: Math.round(s.ageMin),
      score: s.score,
      band: s.band,
      bytes: m.bytes ?? null,
      sharedWith: m.sharedWith ?? 0,
      reasons: reasonsFor(t, s),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return { mode: provider.mode, tabs: scored };
}

function reasonsFor(tab, s) {
  const r = [];
  if (tab.audible) r.push("playing audio");
  if (s.ageMin > 120) r.push(`idle ${Math.round(s.ageMin / 60)}h`);
  else if (s.ageMin > 30) r.push(`idle ${Math.round(s.ageMin)}m`);
  if (tab.discarded) r.push("already asleep");
  if (tab.pinned) r.push("pinned");
  return r;
}

// ---- Actions --------------------------------------------------------------

async function focusTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return { ok: true };
}

async function closeTabs(tabIds) {
  const tabs = await Promise.all(
    tabIds.map((id) => chrome.tabs.get(id).catch(() => null))
  );
  const urls = tabs.filter(Boolean).map((t) => t.url);
  await chrome.storage.local.set({ [UNDO_KEY]: urls });
  await chrome.tabs.remove(tabIds);
  return { closed: tabIds.length };
}

async function undoLast() {
  const data = await chrome.storage.local.get(UNDO_KEY);
  const urls = data[UNDO_KEY] || [];
  let n = 0;
  for (const url of urls) {
    if (/^https?:/.test(url)) {
      await chrome.tabs.create({ url, active: false });
      n++;
    }
  }
  await chrome.storage.local.remove(UNDO_KEY);
  return { restored: n };
}

// ---- Phase 2: stash (bookmark folders) ------------------------------------

// Stash a set of tabs into a bookmark folder, then close them.
// `name` is optional — falls back to a timestamp when empty.
async function stashTabs(tabIds, name) {
  const tabs = await Promise.all(
    tabIds.map((id) => chrome.tabs.get(id).catch(() => null))
  );
  const valid = tabs.filter((t) => t && t.url && /^https?:/.test(t.url));
  if (!valid.length) return { folderId: null, count: 0, title: null };

  const root = await ensureFolder(STASH_ROOT);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const clean = (name ?? "").trim();
  const folder = await chrome.bookmarks.create({
    parentId: root.id,
    title: clean ? clean : `Stash ${stamp}`, // user name, else date fallback
  });

  for (const t of valid) {
    await chrome.bookmarks.create({
      parentId: folder.id,
      title: t.title || t.url,
      url: t.url,
    });
  }

  // Write the bookmark BEFORE closing, so a crash mid-stash can't lose a URL.
  const closeIds = valid.map((t) => t.id);
  await chrome.storage.local.set({ [UNDO_KEY]: valid.map((t) => t.url) });
  await chrome.tabs.remove(closeIds);

  return { folderId: folder.id, count: valid.length, title: folder.title };
}

async function ensureFolder(title) {
  const found = await chrome.bookmarks.search({ title });
  const existing = found.find((b) => !b.url);
  if (existing) return existing;
  return chrome.bookmarks.create({ title }); // defaults under "Other bookmarks"
}

async function listStashes() {
  const root = await ensureFolder(STASH_ROOT);
  const [node] = await chrome.bookmarks.getSubTree(root.id);
  return (node.children || [])
    .filter((c) => !c.url)
    .map((c) => ({
      id: c.id,
      title: c.title,
      count: (c.children || []).filter((x) => x.url).length,
      dateAdded: c.dateAdded || 0,
    }))
    .sort((a, b) => b.dateAdded - a.dateAdded);
}

async function restoreStash(folderId) {
  const [folder] = await chrome.bookmarks.getSubTree(folderId);
  let n = 0;
  for (const bm of folder.children || []) {
    if (bm.url) {
      await chrome.tabs.create({ url: bm.url, active: false });
      n++;
    }
  }
  return { restored: n };
}
