/**
 * Performance test — formatter cache must keep 10k formats under budget.
 *
 * Before adj-139.2.6, CommandChat's formatTimestamp() called
 * `new Intl.DateTimeFormat(...)` and `new Date(...)` per message render.
 * Formatting 10k messages took >500ms in dev mode, dominating list
 * scroll-back rendering.
 *
 * After the fix, getTimeFormatter() returns a singleton instance and
 * formatDateCached() hits the LRU cache on repeat dates. 10k formats
 * should land comfortably under 50ms (wall-clock, jsdom Node).
 *
 * The threshold is generous to keep this test reliable across machines;
 * the comparison against the unbounded path documents the win.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getTimeFormatter,
  formatDateCached,
  _resetDateFormatterCachesForTests,
} from "../../src/utils/dateFormatter";

const N = 10_000;
const MAX_MS_CACHED = 50;

// Pre-generate timestamps. We use only ~50 unique values to mirror real
// chat data (many messages within the same minute → high cache hit rate).
function makeTimestamps(count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const minute = i % 50;
    const ts = new Date(2026, 4, 17, 12, minute, 0).toISOString();
    out.push(ts);
  }
  return out;
}

describe("formatter cache performance", () => {
  beforeEach(() => {
    _resetDateFormatterCachesForTests();
  });

  it(`formats ${N.toLocaleString()} messages in < ${MAX_MS_CACHED}ms with the cache`, () => {
    const timestamps = makeTimestamps(N);
    const fmt = getTimeFormatter("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    // Warm-up: prime the formatter (first construction is the expensive one).
    formatDateCached(timestamps[0], fmt);

    const start = performance.now();
    for (let i = 0; i < N; i++) {
      formatDateCached(timestamps[i], fmt);
    }
    const elapsed = performance.now() - start;

    // Print so CI logs show the actual figure when the assertion holds.
    // eslint-disable-next-line no-console
    console.log(`formatter-cache: ${N} formats in ${elapsed.toFixed(2)}ms`);

    expect(elapsed).toBeLessThan(MAX_MS_CACHED);
  });

  it("the cached path is dramatically faster than allocating a fresh formatter per call", () => {
    const timestamps = makeTimestamps(N);

    // Naive path (mirrors the OLD CommandChat.tsx code):
    const naiveStart = performance.now();
    for (let i = 0; i < N; i++) {
      const fmt = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      fmt.format(new Date(timestamps[i]));
    }
    const naiveElapsed = performance.now() - naiveStart;

    // Cached path:
    _resetDateFormatterCachesForTests();
    const fmt = getTimeFormatter("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const cachedStart = performance.now();
    for (let i = 0; i < N; i++) {
      formatDateCached(timestamps[i], fmt);
    }
    const cachedElapsed = performance.now() - cachedStart;

    // eslint-disable-next-line no-console
    console.log(
      `formatter-cache: naive ${naiveElapsed.toFixed(2)}ms vs cached ${cachedElapsed.toFixed(2)}ms ` +
      `(speedup ${(naiveElapsed / cachedElapsed).toFixed(1)}x)`,
    );

    // The cached path should be at least 5x faster — generous threshold
    // so we don't flake on a fast machine where naive is already cheap.
    // (Typical observed speedup: 30-200x.)
    expect(cachedElapsed * 5).toBeLessThan(naiveElapsed);
  });
});
