// options.js — editable custom ruleset for the options page.
//
// This talks to chrome.storage.local directly (this is an extension page,
// not the pure scoring/categorization modules). It writes the same
// `customRules` array that background.js reads at the top of
// getScoredTabs() and layers on top of the built-in RULES via
// categorizeWithRules() in ../categories.js — custom rules win over a
// built-in categorization for the same host (checked first, first match
// wins). categorize()/RULES in categories.js are never modified by this
// page; they stay the pure, unit-tested built-in defaults.

import { CATEGORIES } from "../categories.js";

const CUSTOM_RULES_KEY = "customRules";
const $ = (sel) => document.querySelector(sel);

let rules = [];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  populateCategorySelect();
  renderBuiltins();
  $("#add-rule").addEventListener("click", onAddRule);
  $("#rule-hosts").addEventListener("keydown", (e) => {
    if (e.key === "Enter") onAddRule();
  });
  await load();
}

function populateCategorySelect() {
  const sel = $("#rule-category");
  sel.innerHTML = Object.entries(CATEGORIES)
    // UNKNOWN is the fallback, not something worth pointing a rule at.
    .filter(([key]) => key !== "UNKNOWN")
    .map(([key, c]) => `<option value="${key}">${escapeHtml(c.label)}</option>`)
    .join("");
}

function renderBuiltins() {
  const list = $("#builtin-list");
  list.innerHTML = Object.entries(CATEGORIES)
    .map(
      ([, c]) =>
        `<li><span class="cat-badge">${escapeHtml(c.label)}</span><span class="muted">weight ${c.weight}</span></li>`
    )
    .join("");
}

async function load() {
  const data = await chrome.storage.local.get(CUSTOM_RULES_KEY);
  rules = sanitizeRules(data[CUSTOM_RULES_KEY]);
  render();
}

// This page is the only writer of customRules and only ever writes valid
// entries, but chrome.storage.local is otherwise unvalidated — a manually
// edited value, a partial write from a future version, or sync/profile
// corruption could hand back something render() (rule.match.map(...)) would
// throw on. Drop anything malformed rather than bricking the options page.
function sanitizeRules(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (r) =>
      r &&
      typeof r === "object" &&
      typeof r.id === "string" &&
      typeof r.cat === "string" &&
      Array.isArray(r.match) &&
      r.match.every((m) => typeof m === "string")
  );
}

async function save() {
  await chrome.storage.local.set({ [CUSTOM_RULES_KEY]: rules });
}

function render() {
  const list = $("#rule-list");
  const countEl = $("#rule-count");

  if (!rules.length) {
    countEl.hidden = true;
    list.innerHTML = `<li class="muted">No custom rules yet — built-in categories only.</li>`;
    return;
  }

  countEl.hidden = false;
  countEl.textContent = rules.length;
  list.innerHTML = "";
  for (const rule of rules) {
    const li = document.createElement("li");
    const label = CATEGORIES[rule.cat] ? CATEGORIES[rule.cat].label : rule.cat;
    li.innerHTML = `
      <span class="cat-badge">${escapeHtml(label)}</span>
      <span class="hosts">${rule.match.map(escapeHtml).join(", ")}</span>
      <button class="btn small danger remove">Remove</button>`;
    li.querySelector(".remove").addEventListener("click", () => removeRule(rule.id));
    list.appendChild(li);
  }
}

async function onAddRule() {
  const cat = $("#rule-category").value;
  const hostsInput = $("#rule-hosts");
  const match = hostsInput.value
    .split(",")
    .map(normalizeHost)
    .filter(Boolean);

  if (!cat || !CATEGORIES[cat]) return toast("Pick a category first.");
  if (!match.length) return toast("Enter at least one host.");

  rules.push({ id: newId(), cat, match });
  await save();
  hostsInput.value = "";
  render();
  toast(`Added rule for ${match.length} host${match.length === 1 ? "" : "s"}.`);
}

async function removeRule(id) {
  rules = rules.filter((r) => r.id !== id);
  await save();
  render();
  toast("Rule removed.");
}

function normalizeHost(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "") // strip a pasted scheme, e.g. "https://"
    .replace(/\/.*$/, "") // strip a pasted path
    .replace(/^www\./, "");
}

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
