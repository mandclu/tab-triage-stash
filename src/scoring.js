// scoring.js
// Pure scoring: a tab + "now" -> a priority score and band.
// Category weight is the backbone; live signals Chrome DOES expose per tab
// (audible, lastAccessed, discarded, pinned) nudge it up or down.

import { CATEGORIES, categorize } from "./categories.js";

export function scoreTab(tab, now) {
  const host = safeHost(tab.url);
  const cat = categorize(host);
  let score = CATEGORIES[cat].weight;

  // Already asleep? Chrome reclaimed most of its RAM — deprioritize hard.
  if (tab.discarded) score -= 60;

  // Actively playing audio/video right now — real, live memory + GPU load.
  if (tab.audible) score += 25;

  // Staleness: the longer since you looked at it, the safer to close.
  const ageMin = tab.lastAccessed ? (now - tab.lastAccessed) / 60000 : 0;
  if (ageMin > 120) score += 20;
  else if (ageMin > 30) score += 10;

  // Pinned tabs are usually deliberate — protect them.
  if (tab.pinned) score -= 40;

  return { host, cat, score, ageMin, band: band(score) };
}

function band(s) {
  if (s >= 90) return "close-first";
  if (s >= 60) return "review";
  return "keep";
}

export function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
