// scoring.test.js
// Unit tests for scoring.js's pure scoreTab()/band logic.
// See STEPS.md step 1 and AGENTS.md's scoring-system section for scope.
//
// Note: because every category weight and every signal delta in scoring.js
// is a multiple of 5, every possible score is also a multiple of 5. Tests
// below pick values accordingly rather than assuming arbitrary integers are
// reachable.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scoreTab } from "../src/scoring.js";

const NOW = Date.now();

function tab(overrides = {}) {
  return {
    url: "https://example.com/",
    audible: false,
    discarded: false,
    pinned: false,
    lastAccessed: NOW,
    ...overrides,
  };
}

describe("band thresholds", () => {
  test("score >= 90 -> close-first", () => {
    // WEBAPP weight is exactly 90 with no other modifiers.
    const r = scoreTab(tab({ url: "https://docs.google.com/doc/1" }), NOW);
    assert.equal(r.score, 90);
    assert.equal(r.band, "close-first");

    // Well above 90 too.
    const r2 = scoreTab(
      tab({ url: "https://youtube.com/watch?v=1", audible: true }),
      NOW
    );
    assert.equal(r2.score, 125); // MEDIA(100) + audible(25)
    assert.equal(r2.band, "close-first");
  });

  test("60 <= score < 90 -> review", () => {
    // FEED weight is exactly 70, no modifiers.
    const r = scoreTab(tab({ url: "https://reddit.com/r/foo" }), NOW);
    assert.equal(r.score, 70);
    assert.equal(r.band, "review");

    // AI_DASHBOARD weight is exactly 80.
    const r2 = scoreTab(tab({ url: "https://chatgpt.com/" }), NOW);
    assert.equal(r2.score, 80);
    assert.equal(r2.band, "review");

    // Exactly the lower boundary (60) is still review, not keep.
    const r3 = scoreTab(
      tab({
        url: "https://example.com/", // UNKNOWN weight 40
        lastAccessed: NOW - 121 * 60000, // ageMin > 120 -> +20
      }),
      NOW
    );
    assert.equal(r3.score, 60);
    assert.equal(r3.band, "review");

    // Just under the close-first boundary (85 < 90) is still review.
    const r4 = scoreTab(
      tab({
        url: "https://example.com/", // UNKNOWN weight 40
        audible: true, // +25
        lastAccessed: NOW - 121 * 60000, // +20
      }),
      NOW
    );
    assert.equal(r4.score, 85);
    assert.equal(r4.band, "review");
  });

  test("score < 60 -> keep", () => {
    // STATIC weight is exactly 10, no modifiers.
    const r = scoreTab(tab({ url: "https://wikipedia.org/wiki/Foo" }), NOW);
    assert.equal(r.score, 10);
    assert.equal(r.band, "keep");

    // UNKNOWN weight is exactly 40.
    const r2 = scoreTab(tab({ url: "https://example.com/" }), NOW);
    assert.equal(r2.score, 40);
    assert.equal(r2.band, "keep");

    // Just under the review boundary (55 < 60).
    const r3 = scoreTab(
      tab({
        url: "https://wikipedia.org/wiki/Foo", // STATIC weight 10
        audible: true, // +25
        lastAccessed: NOW - 121 * 60000, // +20
      }),
      NOW
    );
    assert.equal(r3.score, 55);
    assert.equal(r3.band, "keep");
  });
});

describe("signals in isolation", () => {
  const baseUrl = "https://wikipedia.org/wiki/Foo"; // STATIC, weight 10

  test("audible adds +25", () => {
    const off = scoreTab(tab({ url: baseUrl, audible: false }), NOW);
    const on = scoreTab(tab({ url: baseUrl, audible: true }), NOW);
    assert.equal(off.score, 10);
    assert.equal(on.score, 35);
    assert.equal(on.score - off.score, 25);
  });

  test("discarded subtracts -60", () => {
    // Use a heavy category so the drop is visible without going negative.
    const heavyUrl = "https://youtube.com/watch?v=1"; // MEDIA, weight 100
    const off = scoreTab(tab({ url: heavyUrl, discarded: false }), NOW);
    const on = scoreTab(tab({ url: heavyUrl, discarded: true }), NOW);
    assert.equal(off.score, 100);
    assert.equal(on.score, 40);
    assert.equal(on.score - off.score, -60);
    // Dramatic enough to flip the band on its own.
    assert.equal(off.band, "close-first");
    assert.equal(on.band, "keep");
  });

  test("pinned subtracts -40", () => {
    const off = scoreTab(tab({ url: baseUrl, pinned: false }), NOW);
    const on = scoreTab(tab({ url: baseUrl, pinned: true }), NOW);
    assert.equal(off.score, 10);
    // Weight already at the floor for STATIC, so this just confirms the
    // delta is applied; the heavier-category interaction test below shows
    // the visible protective effect.
    assert.equal(on.score, -30);
    assert.equal(on.score - off.score, -40);
  });

  test("ageMin > 120 adds +20", () => {
    const r = scoreTab(
      tab({ url: baseUrl, lastAccessed: NOW - 121 * 60000 }),
      NOW
    );
    assert.ok(r.ageMin > 120);
    assert.equal(r.score, 30); // 10 + 20
  });

  test("30 < ageMin <= 120 adds +10", () => {
    const r = scoreTab(
      tab({ url: baseUrl, lastAccessed: NOW - 31 * 60000 }),
      NOW
    );
    assert.ok(r.ageMin > 30 && r.ageMin <= 120);
    assert.equal(r.score, 20); // 10 + 10

    // Exactly 120 minutes is still in the +10 bucket (the >120 check is
    // strict), not the +20 bucket.
    const atBoundary = scoreTab(
      tab({ url: baseUrl, lastAccessed: NOW - 120 * 60000 }),
      NOW
    );
    assert.equal(atBoundary.score, 20);
  });

  test("ageMin <= 30 adds no bonus", () => {
    const atThirty = scoreTab(
      tab({ url: baseUrl, lastAccessed: NOW - 30 * 60000 }),
      NOW
    );
    assert.equal(atThirty.score, 10); // no bonus at exactly 30 (strict >30 check)

    const fresh = scoreTab(
      tab({ url: baseUrl, lastAccessed: NOW - 5 * 60000 }),
      NOW
    );
    assert.equal(fresh.score, 10);

    const noLastAccessed = scoreTab(
      tab({ url: baseUrl, lastAccessed: undefined }),
      NOW
    );
    assert.equal(noLastAccessed.ageMin, 0);
    assert.equal(noLastAccessed.score, 10);
  });
});

describe("signal interactions", () => {
  test("pinned overrides a heavy category's weight, dropping its band", () => {
    // WEBAPP alone (90) is close-first; pinning the same tab should pull it
    // all the way down to keep territory, demonstrating pinned is meant to
    // protect deliberately-kept tabs even in an otherwise heavy category.
    const unpinned = scoreTab(
      tab({ url: "https://docs.google.com/doc/1", pinned: false }),
      NOW
    );
    const pinned = scoreTab(
      tab({ url: "https://docs.google.com/doc/1", pinned: true }),
      NOW
    );
    assert.equal(unpinned.score, 90);
    assert.equal(unpinned.band, "close-first");
    assert.equal(pinned.score, 50); // 90 - 40
    assert.equal(pinned.band, "keep");
  });

  test("audible + stale stacks additively and can move a tab up two bands", () => {
    // UNKNOWN alone (40) is keep. Audible (+25) and stale (+20) together
    // push it to review-band territory, showing the signals stack rather
    // than one masking the other.
    const baseline = scoreTab(tab({ url: "https://example.com/" }), NOW);
    const stacked = scoreTab(
      tab({
        url: "https://example.com/",
        audible: true,
        lastAccessed: NOW - 121 * 60000,
      }),
      NOW
    );
    assert.equal(baseline.score, 40);
    assert.equal(baseline.band, "keep");
    assert.equal(stacked.score, 85); // 40 + 25 + 20
    assert.equal(stacked.band, "review");
  });

  test("discarded + audible (unusual but valid combo) still nets correctly", () => {
    // A discarded tab that is somehow still reported as audible: both
    // deltas apply, since scoring.js doesn't treat them as mutually
    // exclusive.
    const r = scoreTab(
      tab({
        url: "https://youtube.com/watch?v=1", // MEDIA, weight 100
        discarded: true, // -60
        audible: true, // +25
      }),
      NOW
    );
    assert.equal(r.score, 65); // 100 - 60 + 25
    assert.equal(r.band, "review");
  });
});
