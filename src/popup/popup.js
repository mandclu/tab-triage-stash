// popup.js — compact summary + quick actions. Delegates work to the worker.
import { confirmChoice } from "../modal.js";

const $ = (s) => document.querySelector(s);
const send = (msg) =>
  chrome.runtime.sendMessage(msg).then((r) => {
    if (!r || !r.ok) throw new Error(r ? r.error : "no response");
    return r.data;
  });

let closeFirstIds = [];

document.addEventListener("DOMContentLoaded", async () => {
  $("#open-report").addEventListener("click", openReport);
  $("#stash-close-first").addEventListener("click", stashCloseFirst);
  await refresh();
  await loadStashes();
});

async function refresh() {
  const { mode, tabs } = await send({ type: "GET_SCORED_TABS" });
  const badge = $("#mode");
  badge.textContent = mode === "measured" ? "Measured" : "Estimated";
  badge.className = "badge " + mode;

  const closeFirst = tabs.filter((t) => t.band === "close-first");
  closeFirstIds = closeFirst.map((t) => t.id);
  $("#summary").textContent =
    `${tabs.length} tabs · ${closeFirst.length} to close first`;
  $("#stash-close-first").disabled = closeFirst.length === 0;
  $("#stash-close-first").textContent =
    `Stash all “Close First” (${closeFirst.length})`;
}

function openReport() {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/report/report.html") });
  window.close();
}

async function stashCloseFirst() {
  if (!closeFirstIds.length) return;
  const name = $("#quick-name").value.trim();

  const targetFolderId = await resolveStashTarget(name);
  if (targetFolderId === "cancel") return;

  const res = await send({ type: "STASH_TABS", tabIds: closeFirstIds, name, targetFolderId });
  $("#quick-name").value = "";
  toast(`Stashed ${res.count} tabs to "${res.title}".`);
  await refresh();
  await loadStashes();
}

// If `name` matches an existing stash folder, ask whether to add to it or
// start a new one with the same name. Returns a folder id to reuse, `null` to
// create a new folder (no conflict, or "Create new" chosen), or "cancel" to
// abort. Mirrors report.js's resolveStashTarget (confirmChoice itself is
// shared — see ../modal.js).
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
  return "cancel";
}

async function loadStashes() {
  const stashes = await send({ type: "LIST_STASHES" });
  const list = $("#stashes");
  if (!stashes.length) {
    list.innerHTML = `<li class="muted">None yet.</li>`;
    return;
  }
  list.innerHTML = "";
  for (const s of stashes.slice(0, 6)) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="t">${escapeHtml(s.title)}</span>
      <span class="muted">${s.count}</span>
      <button class="btn small restore">Reopen</button>`;
    li.querySelector(".restore").addEventListener("click", async () => {
      const res = await send({ type: "RESTORE_STASH", folderId: s.id });
      toast(`Reopened ${res.restored} tabs.`);
    });
    list.appendChild(li);
  }
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
