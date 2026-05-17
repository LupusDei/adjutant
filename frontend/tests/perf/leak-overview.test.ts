/**
 * Overview-page heap leak regression test.
 *
 * Locks in the heap-growth budget from `frontend/perf-budgets.md`:
 *   - Growth <= 10MB per 60s of idle observation on the overview page.
 *
 * This test drives a real Chromium via Puppeteer against a production
 * preview build (`npm run build && npm run preview`). It is gated behind
 * the `RUN_PERF=1` env var so it does not execute in the default vitest
 * suite — running headless Chromium on every CI job is noisy and slow.
 *
 * To run locally:
 *
 *   cd frontend
 *   npm run build
 *   npm run preview &
 *   PREVIEW_PID=$!
 *   RUN_PERF=1 npm run test:perf
 *   kill $PREVIEW_PID
 *
 * Optional env overrides:
 *   PREVIEW_URL  — default http://localhost:4173
 *
 * Pre-overhaul baseline: linear growth -> OOM crash. Post-overhaul: stable
 * heap across multiple 60s windows.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { type Browser, type Page } from 'puppeteer';

const PREVIEW_URL = process.env.PREVIEW_URL ?? 'http://localhost:4173';
const SHOULD_RUN = process.env.RUN_PERF === '1';
const MAX_GROWTH_BYTES = 10 * 1024 * 1024; // 10MB per 60s window
const SAMPLE_COUNT = 4; // 3 intervals between 4 samples
const INTERVAL_MS = 60_000;

describe.skipIf(!SHOULD_RUN)('overview page leak regression', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
    await page.goto(PREVIEW_URL, { waitUntil: 'networkidle0' });
    // Best-effort wait for overview to mount. The dashboard mounts the
    // overview at root, so we wait for a stable selector; if missing we
    // continue anyway and still measure heap growth on whatever is loaded.
    await page
      .waitForSelector('[data-view="overview"]', { timeout: 10_000 })
      .catch(() => undefined);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it('should keep heap growth <= 10MB per 60s interval over 3 intervals', async () => {
    const samples: number[] = [];

    for (let i = 0; i < SAMPLE_COUNT; i++) {
      // Force GC via CDP before sampling so we measure retained, not transient, heap.
      const client = await page.createCDPSession();
      await client.send('HeapProfiler.collectGarbage').catch(() => undefined);

      const metrics = await page.metrics();
      const used = metrics.JSHeapUsedSize ?? 0;
      samples.push(used);

      if (i < SAMPLE_COUNT - 1) {
        await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
      }
    }

    const growths: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      growths.push(samples[i] - samples[i - 1]);
    }

    growths.forEach((growth, idx) => {
      const mb = (growth / 1024 / 1024).toFixed(2);
      expect(
        growth,
        `interval ${idx + 1} grew ${mb}MB (budget ${(MAX_GROWTH_BYTES / 1024 / 1024).toFixed(0)}MB)`,
      ).toBeLessThan(MAX_GROWTH_BYTES);
    });
  }, 5 * 60_000);
});
