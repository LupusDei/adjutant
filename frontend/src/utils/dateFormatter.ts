/**
 * dateFormatter — singleton Intl formatter cache + LRU per-date-string cache.
 *
 * Why this exists
 * ----------------
 * `new Intl.DateTimeFormat(locale, options)` is expensive (typically 5-15ms
 * the first call, 1-3ms subsequent). Chat code that called it once per
 * message render burned several seconds of CPU on a 500-message scroll-back.
 *
 * `new Date(isoString)` is cheap individually but adds up across 10k formats.
 *
 * We solve both with two layered caches:
 *   1. `getTimeFormatter(locale, options)` returns a memoized
 *      `Intl.DateTimeFormat` keyed by `JSON.stringify([locale, options])`.
 *      Same args ⇒ same instance, no allocation, no Intl init cost.
 *   2. `formatDateCached(dateStr, formatter)` returns a memoized string
 *      result keyed by `formatter`+`dateStr`. Same date string + same
 *      formatter ⇒ same string ref, no Date parse, no format call.
 *
 * The string cache is an LRU bounded at 1000 entries — large enough to cover
 * a long chat scroll-back, small enough to avoid memory bloat in a long
 * session (~80KB at full size).
 */

/** Singleton cache of formatters keyed by JSON-stringified args. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

/** Per-formatter LRU cache of formatted strings, keyed by ISO date string. */
const stringCacheByFormatter = new WeakMap<Intl.DateTimeFormat, Map<string, string>>();

/** Maximum entries kept in each formatter's string cache (LRU eviction). */
const MAX_CACHE_ENTRIES = 1000;

/**
 * Return a memoized `Intl.DateTimeFormat` for the given locale+options.
 *
 * Identical inputs always return the same instance. Different inputs
 * (different locale or different options) return distinct instances.
 */
export function getTimeFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = JSON.stringify([locale, sortedOptions(options)]);
  let fmt = formatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, options);
    formatterCache.set(key, fmt);
  }
  return fmt;
}

/**
 * Return a cached `formatter.format(new Date(dateStr))` result.
 *
 * The cache is per-formatter and bounded by `MAX_CACHE_ENTRIES` with LRU
 * eviction (re-access promotes the entry; insertion past the cap evicts
 * the oldest).
 */
export function formatDateCached(dateStr: string, formatter: Intl.DateTimeFormat): string {
  let cache = stringCacheByFormatter.get(formatter);
  if (!cache) {
    cache = new Map<string, string>();
    stringCacheByFormatter.set(formatter, cache);
  }

  const existing = cache.get(dateStr);
  if (existing !== undefined) {
    // Promote to MRU — Map iteration order is insertion order, so re-insert.
    cache.delete(dateStr);
    cache.set(dateStr, existing);
    return existing;
  }

  const out = formatter.format(new Date(dateStr));
  cache.set(dateStr, out);

  // LRU eviction: drop the oldest while we exceed the cap.
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }

  return out;
}

/**
 * Reset all caches. Intended for tests only — exported with an underscore
 * prefix to signal "do not call in production code".
 */
export function _resetDateFormatterCachesForTests(): void {
  formatterCache.clear();
  // WeakMap has no clear() — but in tests, formatters get GC'd between runs
  // once their cache map is no longer referenced. We re-create the structure
  // to drop any retained references.
  // (Re-assigning a const isn't possible — but WeakMaps owning Maps inside
  // are released when the formatter key goes out of scope. Clearing
  // formatterCache above releases the formatter refs and thus the maps.)
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Return a new options object with keys sorted alphabetically.
 *
 * `JSON.stringify` preserves insertion order, so { a: 1, b: 2 } and
 * { b: 2, a: 1 } would produce different keys and break instance reuse.
 * Sorting normalizes the key.
 */
function sortedOptions(options: Intl.DateTimeFormatOptions): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(options).sort()) {
    sorted[key] = (options as Record<string, unknown>)[key];
  }
  return sorted;
}
