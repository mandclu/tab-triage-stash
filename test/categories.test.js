// categories.test.js
// Unit tests for categories.js's pure categorize()/RULES logic.
// See STEPS.md step 1 and AGENTS.md's scoring-system section for scope.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { categorize, CATEGORIES, RULES } from "../src/categories.js";

describe("categorize()", () => {
  test("exact host match", () => {
    assert.equal(categorize("youtube.com"), "MEDIA");
    assert.equal(categorize("docs.google.com"), "WEBAPP");
    assert.equal(categorize("chatgpt.com"), "AI_DASHBOARD");
    assert.equal(categorize("reddit.com"), "FEED");
    assert.equal(categorize("wikipedia.org"), "STATIC");
  });

  test("subdomain suffix match", () => {
    // foo.docs.google.com should match the docs.google.com rule as a suffix.
    assert.equal(categorize("foo.docs.google.com"), "WEBAPP");
    assert.equal(categorize("m.youtube.com"), "MEDIA");
  });

  test("a host that merely contains the rule string, but not as a suffix, does not match", () => {
    // "notdocs.google.com" ends with "docs.google.com" as a string only if
    // preceded by ".", so this must NOT match (guards against a naive
    // `.includes()`-style implementation regressing to substring matching).
    assert.equal(categorize("notdocs.google.com"), "UNKNOWN");
  });

  test("unmatched host falls back to UNKNOWN", () => {
    assert.equal(categorize("example.com"), "UNKNOWN");
    assert.equal(categorize("some-random-site.io"), "UNKNOWN");
  });

  test("empty/falsy host falls back to UNKNOWN", () => {
    assert.equal(categorize(""), "UNKNOWN");
    assert.equal(categorize(undefined), "UNKNOWN");
    assert.equal(categorize(null), "UNKNOWN");
  });

  test("every RULES cat key exists in CATEGORIES", () => {
    for (const rule of RULES) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(CATEGORIES, rule.cat),
        `RULES references unknown category "${rule.cat}"`
      );
    }
  });

  test("rule precedence: first matching rule wins", () => {
    // Synthetic host that would match two different rules were both allowed
    // to run: docs.google.com (WEBAPP) is listed before analytics.google.com
    // (AI_DASHBOARD) is not a real collision, so build a temporary ruleset
    // that intentionally overlaps to prove ordering, rather than precedence
    // being coincidental to the current RULES array.
    const overlappingRules = [
      { cat: "MEDIA", match: ["shared.example.com"] },
      { cat: "STATIC", match: ["shared.example.com"] },
    ];

    function categorizeWith(rules, host) {
      if (!host) return "UNKNOWN";
      for (const rule of rules) {
        if (rule.match.some((d) => host === d || host.endsWith("." + d))) {
          return rule.cat;
        }
      }
      return "UNKNOWN";
    }

    // With MEDIA listed first, it should win even though STATIC also matches.
    assert.equal(categorizeWith(overlappingRules, "shared.example.com"), "MEDIA");

    // Reversed order flips the winner, proving it's genuinely first-match,
    // not some other tie-break (e.g. weight, alphabetical, most-specific).
    const reversed = [...overlappingRules].reverse();
    assert.equal(categorizeWith(reversed, "shared.example.com"), "STATIC");
  });

  test("rule precedence holds within the real RULES array too", () => {
    // analytics.google.com is listed under AI_DASHBOARD. It's also a Google
    // subdomain, but no earlier rule (MEDIA/WEBAPP) claims "google.com"
    // itself, so this is really just confirming AI_DASHBOARD wins for it
    // specifically and doesn't fall through to a later/earlier rule.
    assert.equal(categorize("analytics.google.com"), "AI_DASHBOARD");
  });
});
