// background.js — MV3 service worker.
// Single source of truth for actions. Durable state (undo buffer) lives in
// chrome.storage so an evicted worker can restart without losing it.

import { scoreTab } from "./scoring.js";
import { CATEGORIES, categorizeWithRules } from "./categories.js";
import { getMemoryProvider } from "./memoryProvider.js";

const UNDO_KEY = "undoBuffer";
const CUSTOM_RULES_KEY = "customRules"; // user rules from src/options/, layered on RULES
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
    case "STASH_TABS":      return stashTabs(msg.tabIds, msg.name, msg.targetFolderId);
    case "FIND_STASH_FOLDER": return findStashFolder(msg.name);
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
  const customRules = await getCustomRules();

  const provider = getMemoryProvider();
  const mem = await provider.forTabs(tabs);
  const memById = Object.fromEntries(mem.map((m) => [m.tabId, m]));

  const scored = tabs.map((t) => {
    // scoreTab() is the pure, unit-tested pipeline (scoring.js) and always
    // categorizes with the built-in RULES only — it stays untouched. Custom
    // rules are layered on top here: if they retarget this host's category,
    // re-derive score/band from the new category's weight so priority
    // (band, sort order) reflects the override, not just the label.
    const s = scoreTab(t, now);
    const cat = customRules.length ? categorizeWithRules(s.host, customRules) : s.cat;
    const { score, band } = applyCategoryOverride(s, cat);
    const m = memById[t.id] || {};
    return {
      id: t.id,
      windowId: t.windowId,
      title: t.title || t.url || "(untitled)",
      url: t.url || "",
      favIconUrl: t.favIconUrl || "",
      host: s.host,
      category: cat,
      categoryLabel: CATEGORIES[cat].label,
      audible: !!t.audible,
      discarded: !!t.discarded,
      pinned: !!t.pinned,
      ageMin: Math.round(s.ageMin),
      score,
      band,
      bytes: m.bytes ?? null,
      sharedWith: m.sharedWith ?? 0,
      reasons: reasonsFor(t, s),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return { mode: provider.mode, tabs: scored };
}

// Custom rules live in chrome.storage.local (see src/options/options.js),
// never a module-level variable — same durable-state rule as the undo
// buffer, so a torn-down/evicted service worker doesn't lose them.
async function getCustomRules() {
  const data = await chrome.storage.local.get(CUSTOM_RULES_KEY);
  return Array.isArray(data[CUSTOM_RULES_KEY]) ? data[CUSTOM_RULES_KEY] : [];
}

// If a custom rule changed this tab's category, re-derive score/band using
// the new category's weight, preserving the same live-signal delta scoreTab
// already applied (discarded/audible/age/pinned). Mirrors scoring.js's band
// thresholds locally rather than touching that file.
function applyCategoryOverride(s, cat) {
  if (cat === s.cat) return { score: s.score, band: s.band };
  const delta = s.score - CATEGORIES[s.cat].weight;
  const score = CATEGORIES[cat].weight + delta;
  return { score, band: bandFor(score) };
}

function bandFor(score) {
  if (score >= 90) return "close-first";
  if (score >= 60) return "review";
  return "keep";
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
  // Only act on ids that still resolve to a real tab — a stale id (e.g. a row
  // closed individually while still checked in a bulk selection) must not
  // poison the whole chrome.tabs.remove() batch.
  const valid = tabs.filter(Boolean);
  if (!valid.length) return { closed: 0, restorable: 0 };
  await chrome.storage.local.set({ [UNDO_KEY]: valid.map((t) => t.url) });
  await chrome.tabs.remove(valid.map((t) => t.id));
  // undoLast() only recreates http(s) URLs (chrome://, extension pages, etc.
  // can't be reopened via chrome.tabs.create with their original URL) — tell
  // the caller how many of the closed tabs Undo can actually bring back, so
  // the UI doesn't promise more than it can deliver.
  const restorable = valid.filter((t) => /^https?:/.test(t.url)).length;
  return { closed: valid.length, restorable };
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

// Look up an existing stash folder by exact title, scoped to the stash root
// (not a global bookmarks search, so it can't match an unrelated folder
// elsewhere on the bookmarks bar). Returns null when no name is given or no
// folder matches — the caller uses this to offer "add to existing" before
// creating a same-named duplicate.
async function findStashFolder(name) {
  const clean = (name ?? "").trim();
  if (!clean) return null;
  const root = await ensureFolder(STASH_ROOT);
  const [node] = await chrome.bookmarks.getSubTree(root.id);
  const match = (node.children || []).find((c) => !c.url && c.title === clean);
  if (!match) return null;
  return {
    id: match.id,
    title: match.title,
    count: (match.children || []).filter((x) => x.url).length,
  };
}

// Stash a set of tabs into a bookmark folder, then close them.
// `name` is optional — falls back to a timestamp when empty.
// `targetFolderId`, when given, adds to that existing folder instead of
// creating a new one (the caller resolved this via findStashFolder() and a
// user choice — see report.js/popup.js's stash-conflict prompt).
async function stashTabs(tabIds, name, targetFolderId) {
  const tabs = await Promise.all(
    tabIds.map((id) => chrome.tabs.get(id).catch(() => null))
  );
  const valid = tabs.filter((t) => t && t.url && /^https?:/.test(t.url));
  if (!valid.length) return { folderId: null, count: 0, title: null };

  let folder;
  if (targetFolderId) {
    const [existing] = await chrome.bookmarks.get(targetFolderId).catch(() => []);
    if (!existing || existing.url) throw new Error("Stash folder not found");
    folder = existing;
  } else {
    const root = await ensureFolder(STASH_ROOT);
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const clean = (name ?? "").trim();
    folder = await chrome.bookmarks.create({
      parentId: root.id,
      title: clean ? clean : `Stash ${stamp}`, // user name, else date fallback
    });
  }

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
