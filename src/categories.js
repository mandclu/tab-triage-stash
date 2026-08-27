// categories.js
// Maps a tab's host to a memory-impact category. Weights are ordinal
// ("close sooner" = higher), NOT megabytes — stable Chrome doesn't expose
// real per-tab memory. See memoryProvider.js for the optional measured mode.

export const CATEGORIES = {
  MEDIA:        { label: "Media & Live Streaming",  weight: 100 },
  WEBAPP:       { label: "Complex Web Apps",        weight: 90  },
  AI_DASHBOARD: { label: "AI Chat & Dashboards",    weight: 80  },
  FEED:         { label: "Infinite Scroll Feeds",   weight: 70  },
  STATIC:       { label: "Static Articles & Docs",  weight: 10  },
  UNKNOWN:      { label: "Uncategorized",           weight: 40  },
};

// Ordered rules — first match wins. Host is matched as an exact host or suffix.
export const RULES = [
  { cat: "MEDIA", match: [
    "youtube.com", "twitch.tv", "netflix.com", "spotify.com",
    "meet.google.com", "zoom.us", "vimeo.com", "hulu.com", "disneyplus.com",
  ]},
  { cat: "WEBAPP", match: [
    "docs.google.com", "sheets.google.com", "slides.google.com",
    "figma.com", "canva.com", "miro.com", "notion.so", "airtable.com",
  ]},
  { cat: "AI_DASHBOARD", match: [
    "chatgpt.com", "chat.openai.com", "gemini.google.com", "claude.ai",
    "perplexity.ai", "analytics.google.com", "datastudio.google.com",
    "lookerstudio.google.com", "grafana.com",
  ]},
  { cat: "FEED", match: [
    "reddit.com", "twitter.com", "x.com", "facebook.com",
    "instagram.com", "linkedin.com", "tiktok.com", "threads.net",
  ]},
  { cat: "STATIC", match: [
    "wikipedia.org", "developer.mozilla.org", "stackoverflow.com",
    "medium.com", "readthedocs.io",
  ]},
];

export function categorize(host) {
  if (!host) return "UNKNOWN";
  for (const rule of RULES) {
    if (rule.match.some((d) => host === d || host.endsWith("." + d))) {
      return rule.cat;
    }
  }
  return "UNKNOWN";
}

// Pure layering helper for the options page's user-defined rules (see
// src/options/). `extraRules` follows the same shape as RULES entries
// (`{ cat, match: [host, ...] }`) and is checked BEFORE the built-in RULES,
// first-match-wins — same semantics as RULES itself, just an earlier list —
// so a custom rule can override a built-in categorization. Falls back to
// categorize(host) when no custom rule matches (or none are given), which
// keeps this additive: categorize()/RULES above are untouched and still
// behave exactly as before when called directly (as scoring.js does).
export function categorizeWithRules(host, extraRules) {
  if (!host) return "UNKNOWN";
  if (Array.isArray(extraRules)) {
    for (const rule of extraRules) {
      if (!rule || !CATEGORIES[rule.cat] || !Array.isArray(rule.match)) continue;
      if (rule.match.some((d) => host === d || host.endsWith("." + d))) {
        return rule.cat;
      }
    }
  }
  return categorize(host);
}
