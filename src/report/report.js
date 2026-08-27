// report.js — renders the linked report and wires actions through the worker.
import { requestMeasuredMemory } from "../memoryProvider.js";
import { confirmChoice } from "../modal.js";

const BANDS = [
  { key: "close-first", label: "Close First", hint: "Heavy and/or active — reclaim these first." },
  { key: "review",      label: "Review",      hint: "Worth a look before closing." },
  { key: "keep",        label: "Keep",        hint: "Light, pinned, or already asleep." },
];

const selected = new Set();
let currentMode = "estimated";
let allTabs = [];       // full, unfiltered result of the last GET_SCORED_TABS
let visibleTabs = [];   // allTabs after the text filter — what's actually rendered
let filterText = "";

const $ = (sel) => document.querySelector(sel);
const send = (msg) =>
  chrome.runtime.sendMessage(msg).then((r) => {
    if (!r || !r.ok) throw new Error(r ? r.error : "no response");
    return r.data;
  });

document.addEventListener("DOMContentLoaded", init);

async function init() {
  $("#refresh").addEventListener("click", load);
  $("#undo").addEventListener("click", onUndo);
  $("#enable-measured").addEventListener("click", onEnableMeasured);
  $("#stash-selected").addEventListener("click", onStashSelected);
  $("#close-selected").addEventListener("click", onCloseSelected);
  $("#filter-input").addEventListener("input", (e) => {
    filterText = e.target.value;
    applyFilter();
  });
  $("#select-shown").addEventListener("click", onSelectShown);
  await load();
  await loadStashes();
}

async function load() {
  selected.clear();
  updateSelectionCount();
  const { mode, tabs } = await send({ type: "GET_SCORED_TABS" });
  currentMode = mode;
  allTabs = tabs;
  renderMode(mode);
  applyFilter(); // re-applies the current filter text and renders visibleTabs
}

// ---- Filter -----------------------------------------------------------

function applyFilter() {
  const needle = filterText.trim().toLowerCase();
  visibleTabs = needle ? allTabs.filter((t) => matchesFilter(t, needle)) : allTabs;
  renderSummary(allTabs);
  renderBands(visibleTabs);
  updateFilterCount(needle);
}

function matchesFilter(t, needle) {
  const haystack = [t.title, t.host, t.categoryLabel, t.url, ...(t.reasons || [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function updateFilterCount(needle) {
  const el = $("#filter-count");
  el.textContent = needle
    ? `${visibleTabs.length} match${visibleTabs.length === 1 ? "" : "es"}`
    : "";
}

function onSelectShown() {
  if (!visibleTabs.length) return toast("No rows shown — nothing to select.");
  visibleTabs.forEach((t) => selected.add(t.id));
  document
    .querySelectorAll("#bands .row input[type=checkbox]")
    .forEach((c) => (c.checked = true));
  updateSelectionCount();
  syncGroupCheckboxes();
}

function renderMode(mode) {
  const badge = $("#mode-badge");
  badge.hidden = false;
  badge.textContent = mode === "measured" ? "Measured" : "Estimated";
  badge.className = "badge " + (mode === "measured" ? "measured" : "estimated");
  $("#enable-measured").hidden = mode === "measured";
}

function renderSummary(tabs) {
  const total = tabs.length;
  const closeFirst = tabs.filter((t) => t.band === "close-first").length;
  const audible = tabs.filter((t) => t.audible).length;
  $("#summary").textContent =
    `${total} tabs · ${closeFirst} to close first · ${audible} playing audio`;
}

// Band- and category-level "select all" checkboxes, kept in sync with
// `selected` — [{ cb, rows }]. Rebuilt on every render; see syncGroupCheckboxes.
let groupCheckboxes = [];
// Shift+click range-select anchor — the last row checkbox clicked. Reset on
// every render since the DOM (and therefore row order) is rebuilt from scratch.
let lastClickedRowId = null;

function renderBands(tabs) {
  const root = $("#bands");
  root.innerHTML = "";
  groupCheckboxes = [];
  lastClickedRowId = null;
  for (const band of BANDS) {
    const rows = tabs.filter((t) => t.band === band.key);
    if (!rows.length) continue;

    const section = document.createElement("section");
    section.className = "band band-" + band.key;
    section.innerHTML = `
      <div class="band-head">
        <input type="checkbox" class="group-check" title="Select all"
               aria-label="Select all in ${escapeAttr(band.label)}" />
        <h2>${band.label} <span class="count">${rows.length}</span></h2>
        <p class="hint">${band.hint}</p>
      </div>`;

    wireGroupCheckbox(section.querySelector(".group-check"), rows);

    for (const group of groupByCategory(rows)) section.appendChild(renderCategoryGroup(group));

    root.appendChild(section);
  }
  syncGroupCheckboxes();
}

// Wires a band/category "select all" checkbox: toggling it selects/deselects
// every row it covers (and their checkboxes), then every group checkbox is
// re-synced since a category toggle also changes its band's state.
function wireGroupCheckbox(cb, rows) {
  cb.addEventListener("change", () => {
    if (cb.checked) rows.forEach((t) => selected.add(t.id));
    else rows.forEach((t) => selected.delete(t.id));
    cb.indeterminate = false;

    const ids = new Set(rows.map((t) => t.id));
    document.querySelectorAll("#bands .row").forEach((rowEl) => {
      if (ids.has(Number(rowEl.dataset.tabId))) {
        const rcb = rowEl.querySelector("input[type=checkbox]");
        if (rcb) rcb.checked = cb.checked;
      }
    });

    updateSelectionCount();
    syncGroupCheckboxes();
  });
  groupCheckboxes.push({ cb, rows });
}

// Recomputes every band/category checkbox's checked/indeterminate state from
// `selected` — call after anything changes which row ids are selected.
function syncGroupCheckboxes() {
  for (const { cb, rows } of groupCheckboxes) {
    const checkedCount = rows.filter((t) => selected.has(t.id)).length;
    cb.checked = rows.length > 0 && checkedCount === rows.length;
    cb.indeterminate = checkedCount > 0 && checkedCount < rows.length;
  }
}

// Sets every row's checkbox (and `selected`) between fromId and toId,
// inclusive, to checkedState — in current DOM order, which matches the
// visual band > category > row layout regardless of grouping boundaries.
// A no-op if either id's row isn't currently rendered (e.g. closed, or
// filtered out).
function selectRange(fromId, toId, checkedState) {
  const rowEls = [...document.querySelectorAll("#bands .row")];
  const ids = rowEls.map((el) => Number(el.dataset.tabId));
  const i = ids.indexOf(fromId);
  const j = ids.indexOf(toId);
  if (i === -1 || j === -1) return;

  const [start, end] = i < j ? [i, j] : [j, i];
  for (let k = start; k <= end; k++) {
    const id = ids[k];
    const rcb = rowEls[k].querySelector("input[type=checkbox]");
    if (rcb) rcb.checked = checkedState;
    checkedState ? selected.add(id) : selected.delete(id);
  }

  updateSelectionCount();
  syncGroupCheckboxes();
}

function groupByCategory(rows) {
  const groups = new Map();
  for (const t of rows) {
    if (!groups.has(t.category)) {
      groups.set(t.category, { label: t.categoryLabel, rows: [] });
    }
    groups.get(t.category).rows.push(t);
  }
  return [...groups.values()];
}

function renderCategoryGroup(group) {
  const wrap = document.createElement("div");
  wrap.className = "category-group";
  wrap.innerHTML = `
    <div class="category-head">
      <input type="checkbox" class="group-check" title="Select all"
             aria-label="Select all in ${escapeAttr(group.label)}" />
      <h3>${escapeHtml(group.label)} <span class="count">${group.rows.length}</span></h3>
    </div>`;

  wireGroupCheckbox(wrap.querySelector(".group-check"), group.rows);

  const list = document.createElement("div");
  list.className = "rows";
  for (const t of group.rows) list.appendChild(renderRow(t));
  wrap.appendChild(list);

  return wrap;
}

function renderRow(t) {
  const row = document.createElement("div");
  row.className = "row";
  row.dataset.tabId = t.id;

  const mem =
    currentMode === "measured" && t.bytes != null
      ? `<span class="mem" title="${t.sharedWith ? "shared by " + (t.sharedWith + 1) + " tabs" : "process RAM"}">${fmtMB(t.bytes)}${t.sharedWith ? " ⁂" : ""}</span>`
      : "";

  const reasons = t.reasons.length
    ? `<span class="reasons">${t.reasons.map((r) => `<span class="chip">${r}</span>`).join("")}</span>`
    : "";

  const fav = t.favIconUrl
    ? `<img class="fav" src="${escapeAttr(t.favIconUrl)}" alt="" />`
    : `<span class="fav placeholder"></span>`;

  row.innerHTML = `
    <input type="checkbox" aria-label="Select tab" title="Select tab (Shift+click to select a range)" />
    ${fav}
    <div class="meta">
      <div class="row-title">${escapeHtml(t.title)}</div>
      <div class="row-sub"><span class="host">${escapeHtml(t.host)}</span>
        <span class="cat">${escapeHtml(t.categoryLabel)}</span>${reasons}</div>
    </div>
    ${mem}
    <div class="row-actions">
      <button class="btn small go">Go to tab</button>
      <button class="btn small danger close">Close</button>
    </div>`;

  const cb = row.querySelector("input");
  cb.checked = selected.has(t.id);
  // Shift+click selects the range between this row and the last-clicked row.
  // The checkbox's own checked state has already flipped to its new value by
  // the time "click" fires (browsers toggle checkedness, then dispatch click,
  // then change) — read it here to decide what state to force onto the range.
  cb.addEventListener("click", (e) => {
    if (e.shiftKey && lastClickedRowId != null && lastClickedRowId !== t.id) {
      selectRange(lastClickedRowId, t.id, cb.checked);
    }
    lastClickedRowId = t.id;
  });
  cb.addEventListener("change", () => {
    cb.checked ? selected.add(t.id) : selected.delete(t.id);
    updateSelectionCount();
    syncGroupCheckboxes();
  });
  row.querySelector(".go").addEventListener("click", () =>
    send({ type: "FOCUS_TAB", tabId: t.id })
  );
  row.querySelector(".close").addEventListener("click", async () => {
    const res = await send({ type: "CLOSE_TABS", tabIds: [t.id] });
    toast(closeToastMessage(res));
    // Reload from the worker rather than just removing this row — allTabs,
    // visibleTabs, and groupCheckboxes still reference the closed tab
    // otherwise, which leaves summary/group counts stale and can re-add its
    // id to `selected` via a later band/category checkbox toggle.
    await load();
  });
  return row;
}

// ---- Toolbar / selection actions -----------------------------------------

async function onStashSelected() {
  const ids = [...selected];
  if (!ids.length) return toast("Select some tabs first.");
  const name = $("#stash-name").value.trim();

  const targetFolderId = await resolveStashTarget(name);
  if (targetFolderId === "cancel") return;

  const res = await send({ type: "STASH_TABS", tabIds: ids, name, targetFolderId });
  $("#stash-name").value = "";
  toast(`Stashed ${res.count} tab${res.count === 1 ? "" : "s"} to "${res.title}".`);
  await load();
  await loadStashes();
}

// If `name` matches an existing stash folder, ask whether to add to it or
// start a new one with the same name. Returns a folder id to reuse, `null` to
// create a new folder (the normal path — no conflict, or the user chose
// "Create new"), or the string "cancel" to abort the stash entirely.
async function resolveStashTarget(name) {
  if (!name) return null;
  const existing = await send({ type: "FIND_STASH_FOLDER", name });
  if (!existing) return null;

  const choice = await confirmChoice(
    `A stash named "${existing.title}" already has ${existing.count} tab${
      existing.count === 1 ? "" : "s"
    }. Add these tabs to it, or start a new stash with the same name?`,
    [
      { key: "existing", label: "Add to existing", className: "primary" },
      { key: "new", label: "Create new" },
      { key: "cancel", label: "Cancel", className: "ghost" },
    ]
  );
  if (choice === "existing") return existing.id;
  if (choice === "new") return null;
  return "cancel"; // chosen "Cancel", or dismissed (backdrop click / Escape)
}

async function onCloseSelected() {
  const ids = [...selected];
  if (!ids.length) return toast("Select some tabs first.");
  const res = await send({ type: "CLOSE_TABS", tabIds: ids });
  toast(closeToastMessage(res));
  await load();
}

// `res.restorable` (from CLOSE_TABS) is how many of the closed tabs Undo can
// actually bring back — chrome://, extension pages, etc. can't be recreated
// with their original URL, so don't tell the user Undo covers tabs it can't.
function closeToastMessage({ closed, restorable }) {
  const tabWord = (n) => `${n} tab${n === 1 ? "" : "s"}`;
  if (closed === 0) return "Nothing to close.";
  if (restorable === closed) return `Closed ${tabWord(closed)} — use Undo to reopen.`;
  if (restorable === 0) return `Closed ${tabWord(closed)} — not restorable via Undo.`;
  return `Closed ${tabWord(closed)} — Undo can restore ${tabWord(restorable)}.`;
}

async function onUndo() {
  const res = await send({ type: "UNDO_LAST" });
  toast(res.restored ? `Reopened ${res.restored} tabs.` : "Nothing to undo.");
  await load();
}

async function onEnableMeasured() {
  const ok = await requestMeasuredMemory(); // user gesture preserved here
  if (ok) {
    toast("Measured memory enabled.");
    await load();
  } else {
    toast("Measured memory needs Chrome Dev channel — staying in estimated mode.");
  }
}

// ---- Stash list -----------------------------------------------------------

async function loadStashes() {
  const stashes = await send({ type: "LIST_STASHES" });
  const list = $("#stash-list");
  if (!stashes.length) {
    list.innerHTML = `<li class="muted">None yet.</li>`;
    return;
  }
  list.innerHTML = "";
  for (const s of stashes) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="stash-title">${escapeHtml(s.title)}</span>
      <span class="muted">${s.count} tab${s.count === 1 ? "" : "s"}</span>
      <button class="btn small restore">Reopen all</button>`;
    li.querySelector(".restore").addEventListener("click", async () => {
      const res = await send({ type: "RESTORE_STASH", folderId: s.id });
      toast(`Reopened ${res.restored} tabs.`);
    });
    list.appendChild(li);
  }
}

// ---- Helpers --------------------------------------------------------------

function updateSelectionCount() {
  $("#selection-count").textContent = `${selected.size} selected`;
}

function fmtMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(0) + " MB";
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function escapeAttr(s) {
  return escapeHtml(s);
}
