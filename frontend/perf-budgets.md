# Performance Budgets

These are the measured thresholds that future changes must respect. Any PR that regresses past a budget is blocked.

## Why these budgets exist

The Adjutant frontend went through a major performance overhaul (epic adj-139) in 2026-05. These budgets lock in the wins.

Pre-overhaul symptoms (from `specs/054-frontend-performance-overhaul/spec.md`):

- Keystroke latency: occasional ~30,000ms freezes under message load.
- Heap: linear growth from leaked listeners, polling intervals, and unbounded arrays, ending in OOM crashes.
- Renders: a single incoming message triggered 50+ component re-renders.

After Wave 1-3 the system was rebuilt around singleton Intl caches, virtualized lists,
memoized row components, a split CommunicationContext, audio cleanup helpers, capped arrays,
and stabilized polling. These budgets enforce that those wins do not silently erode.

## Budgets

### Keystroke latency

- **p50 <= 16ms**, **p99 <= 50ms** measured from `keydown` event to `input` element value displayed.
- Test: `frontend/tests/perf/keystroke-latency.test.ts`.
- Pre-overhaul baseline: **30,000+ms** under load. Regression threshold: any p99 > 50ms fails.

### Heap growth on overview page

- **Growth <= 10MB per 60s** of idle observation on the overview page.
- **Absolute heap <= 200MB** after 8 hours (extrapolated from a ~10 min sample at the regression threshold).
- Test: `frontend/tests/perf/leak-overview.test.ts`.
- Pre-overhaul baseline: linear growth -> OOM crash.

### Initial paint

- Chat with 1000 messages: **<= 100ms** to first paint.
- BeadsList with 500 beads: **<= 100ms** to first paint.
- Timeline with 1000 events: **<= 100ms** to first paint.

### Scroll FPS

- **>= 55fps** on all long lists (chat, beads, timeline). Measured against virtualized lists
  (`react-virtuoso`) backed by memoized row components.

### Formatter cache

- 10,000 timestamp formats in **<= 50ms** wall-clock.
- Test: `frontend/tests/perf/formatter-cache.test.ts` (already on main; runs in the default vitest suite).
- Baseline observed: 169x speedup vs. per-call `new Intl.DateTimeFormat(...)`.

### Render fan-out

- A single incoming message triggers **<= 3 component re-renders** (verified via React DevTools Profiler).
- Pre-overhaul: 50+. Enforced structurally through the split CommunicationContext and memoized
  row components rather than via an automated test.

## Running the budgets

The Puppeteer-based budgets require a production build. Dev mode (`npm run dev`) is several times
slower than production and is **not budgetable** — do not measure perf against `vite dev`.

```bash
cd frontend
npm run build
npm run preview &
PREVIEW_PID=$!
# Wait a moment for preview to bind, then run the perf suite.
RUN_PERF=1 npm run test:perf
kill $PREVIEW_PID
```

You can override the preview URL with `PREVIEW_URL=http://localhost:4173` (the default).

## When budgets fail

1. Verify you are using a production build (`npm run build && npm run preview`). Dev mode is not budgetable.
2. Profile with React DevTools Profiler to find the regression — look for renders triggered by
   `CommunicationContext`, formatter calls outside the singleton cache, or unmemoized row components.
3. Open a bead and assign for fix **before** merging. Performance regressions are bugs, not warnings.

## Test gating

The Puppeteer-based tests are gated behind `RUN_PERF=1` so they do not run in the default
`vitest run` suite. This avoids flakiness on shared CI runners that lack a preview server
or a stable Chromium binary. Run them locally before significant perf-touching changes; CI may
invoke them on demand via `workflow_dispatch`.

The non-Puppeteer perf test (`formatter-cache.test.ts`) is always on and runs in the default
suite, because it has no environmental dependencies.

## Related

- Epic: `adj-139` (frontend performance overhaul)
- Spec: `specs/054-frontend-performance-overhaul/spec.md` (User Story 5 + Success Criteria SC-001..SC-007)
- Verification harness bead: `adj-139.6`
