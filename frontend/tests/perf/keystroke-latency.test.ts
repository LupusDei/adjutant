/**
 * Chat-input keystroke latency benchmark.
 *
 * Locks in the keystroke-latency budget from `frontend/perf-budgets.md`:
 *   - p50 <= 16ms, p99 <= 50ms from keydown to input value displayed.
 *
 * Pre-overhaul baseline: 30,000+ ms freezes under load. Post-overhaul
 * (singleton Intl cache + split CommunicationContext + memoized rows):
 * sub-frame typing latency.
 *
 * This test drives a real Chromium via Puppeteer against a production
 * preview build (`npm run build && npm run preview`). It is gated behind
 * the `RUN_PERF=1` env var so it does not run in the default vitest suite.
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
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { type Browser, type Page } from 'puppeteer';

const PREVIEW_URL = process.env.PREVIEW_URL ?? 'http://localhost:4173';
const SHOULD_RUN = process.env.RUN_PERF === '1';

const P50_BUDGET_MS = 16;
const P99_BUDGET_MS = 50;

const PHRASE = 'the quick brown fox jumps over the lazy dog';

describe.skipIf(!SHOULD_RUN)('chat input keystroke latency', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
    await page.goto(`${PREVIEW_URL}/chat`, { waitUntil: 'networkidle0' });
    // Wait for a chat input to mount. Try common selectors in order.
    await page.waitForSelector('input[type="text"], textarea', {
      timeout: 10_000,
    });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it('should display each typed character within p99 <= 50ms', async () => {
    const input = await page.$('input[type="text"], textarea');
    if (!input) {
      throw new Error('chat input not found at /chat');
    }
    await input.focus();

    const samples: number[] = [];

    for (const ch of PHRASE) {
      const key = ch === ' ' ? 'Space' : ch;
      const expected = ch;

      const start = await page.evaluate(() => performance.now());
      await page.keyboard.press(key);
      // Wait until the focused input's value ends with the expected character.
      // We use requestAnimationFrame to align with the renderer's paint cycle.
      await page.evaluate(
        (expectedChar) =>
          new Promise<void>((resolve) => {
            const check = () => {
              const el = document.activeElement as
                | HTMLInputElement
                | HTMLTextAreaElement
                | null;
              if (el && typeof el.value === 'string' && el.value.endsWith(expectedChar)) {
                resolve();
              } else {
                requestAnimationFrame(check);
              }
            };
            check();
          }),
        expected,
      );
      const end = await page.evaluate(() => performance.now());
      samples.push(end - start);
    }

    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)];
    const p99 = samples[Math.floor(samples.length * 0.99)];

    expect(
      p50,
      `p50=${p50.toFixed(2)}ms (budget ${P50_BUDGET_MS}ms); all=${samples.map((s) => s.toFixed(1)).join(',')}`,
    ).toBeLessThanOrEqual(P50_BUDGET_MS);
    expect(
      p99,
      `p99=${p99.toFixed(2)}ms (budget ${P99_BUDGET_MS}ms)`,
    ).toBeLessThanOrEqual(P99_BUDGET_MS);
  }, 2 * 60_000);
});
