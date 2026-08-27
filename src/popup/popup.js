// popup.js — compact summary + quick actions. Delegates work to the worker.
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
  const name = $("#quick-name").value;
  const res = await send({ type: "STASH_TABS", tabIds: closeFirstIds, name });
  $("#quick-name").value = "";
  toast(`Stashed ${res.count} tabs to "${res.title}".`);
  await refresh();
  await loadStashes();
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
