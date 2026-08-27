// report.js — renders the linked report and wires actions through the worker.
import { requestMeasuredMemory } from "../memoryProvider.js";

const BANDS = [
  { key: "close-first", label: "Close First", hint: "Heavy and/or active — reclaim these first." },
  { key: "review",      label: "Review",      hint: "Worth a look before closing." },
  { key: "keep",        label: "Keep",        hint: "Light, pinned, or already asleep." },
];

const selected = new Set();
let currentMode = "estimated";

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
  await load();
  await loadStashes();
}

async function load() {
  selected.clear();
  updateSelectionCount();
  const { mode, tabs } = await send({ type: "GET_SCORED_TABS" });
  currentMode = mode;
  renderMode(mode);
  renderSummary(tabs);
  renderBands(tabs);
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

function renderBands(tabs) {
  const root = $("#bands");
  root.innerHTML = "";
  for (const band of BANDS) {
    const rows = tabs.filter((t) => t.band === band.key);
    if (!rows.length) continue;

    const section = document.createElement("section");
    section.className = "band band-" + band.key;
    section.innerHTML = `
      <div class="band-head">
        <h2>${band.label} <span class="count">${rows.length}</span></h2>
        <p class="hint">${band.hint}</p>
        <button class="btn ghost small select-band">Select all</button>
      </div>`;

    const list = document.createElement("div");
    list.className = "rows";
    for (const t of rows) list.appendChild(renderRow(t));
    section.appendChild(list);

    section.querySelector(".select-band").addEventListener("click", () => {
      rows.forEach((t) => selected.add(t.id));
      section.querySelectorAll("input[type=checkbox]").forEach((c) => (c.checked = true));
      updateSelectionCount();
    });

    root.appendChild(section);
  }
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
    <input type="checkbox" aria-label="Select tab" />
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
  cb.addEventListener("change", () => {
    cb.checked ? selected.add(t.id) : selected.delete(t.id);
    updateSelectionCount();
  });
  row.querySelector(".go").addEventListener("click", () =>
    send({ type: "FOCUS_TAB", tabId: t.id })
  );
  row.querySelector(".close").addEventListener("click", async () => {
    await send({ type: "CLOSE_TABS", tabIds: [t.id] });
    toast("Closed 1 tab — use Undo to reopen.");
    row.remove();
  });
  return row;
}

// ---- Toolbar / selection actions -----------------------------------------

async function onStashSelected() {
  const ids = [...selected];
  if (!ids.length) return toast("Select some tabs first.");
  const name = $("#stash-name").value;
  const res = await send({ type: "STASH_TABS", tabIds: ids, name });
  $("#stash-name").value = "";
  toast(`Stashed ${res.count} tab${res.count === 1 ? "" : "s"} to "${res.title}".`);
  await load();
  await loadStashes();
}

async function onCloseSelected() {
  const ids = [...selected];
  if (!ids.length) return toast("Select some tabs first.");
  const res = await send({ type: "CLOSE_TABS", tabIds: ids });
  toast(`Closed ${res.closed} tabs — use Undo to reopen.`);
  await load();
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
