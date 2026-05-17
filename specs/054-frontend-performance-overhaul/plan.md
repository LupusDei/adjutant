# Implementation Plan: Adjutant Frontend Performance Overhaul

**Branch**: `054-frontend-performance-overhaul` | **Date**: 2026-05-17
**Epic**: `adj-139` | **Priority**: P0

## Summary

Compound performance failure across the Adjutant frontend stack — root cause is the CommunicationContext value being invalidated on every WS frame, which fans re-renders across the entire React tree, multiplied by uncapped state arrays, leaked listeners, and unmemoized full-list renders. Fix in six tracks: split the context, track `seq` client-side, plug specific memory leaks, virtualize all major lists, reduce CRT GPU cost, and install a regression harness.

## Bead Map

- `adj-139` — Root: Frontend Performance Overhaul
  - `adj-139.1` — Track A: Communication Layer Refactor (P0)
  - `adj-139.2` — Track B: Chat Page Render Storm Fix (P0)
  - `adj-139.3` — Track C: Memory Leak Eradication (P0)
  - `adj-139.4` — Track D: List Virtualization + Memoization (P1)
  - `adj-139.5` — Track E: CSS/Animation Cost Reduction (P2)
  - `adj-139.6` — Track F: Verification Harness (P1)

## Technical Context

**Stack**: React 18 + TypeScript (strict) + Vite + Tailwind. Vitest for tests.
**Storage**: SQLite (backend); React state + context (frontend).
**Testing**: Vitest unit, Puppeteer for headless memory/perf regression.
**Constraints**: Must keep retro CRT aesthetic. Must not break any existing user-facing feature. Must not regress test coverage thresholds (80% lines, 70% branches, 60% functions).

## Architecture Decision

**Why split CommunicationContext rather than memoize harder?** The fundamental issue is that `connectionStatus` is in the same context value as `sendMessage` and `subscribe`. These have wildly different change frequencies — `sendMessage` is stable across the session, `connectionStatus` flips on every WS frame. Memoizing the value object cannot help when one of its members changes. Splitting into two contexts allows components that only need the stable bits to escape re-renders entirely.

**Why react-virtuoso over react-window?** Virtuoso supports auto-scroll-to-bottom (critical for chat), variable row heights, and the `Virtuoso` + `TableVirtuoso` components match our DOM shapes without forcing fixed heights. It's slightly heavier (~20KB gzipped) than react-window, but the API ergonomic fit and chat-specific features justify the size.

**Why cap arrays rather than persist to IndexedDB?** A 1000-message cap covers >99% of active-session use. Older messages remain server-side and can be fetched on demand via existing pagination. IndexedDB persistence is a separate feature, out of scope.

**Why not server-render markdown?** Tempting but invasive — would require changing the message schema, migrating data, and adding XSS hardening on the server. Memoizing client-side with stable plugin references gets us 90% of the win for 5% of the work.

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/contexts/CommunicationContext.tsx` | Split into Actions + Status contexts, add seq tracking, sync_response handler, listener cleanup |
| `frontend/src/components/chat/CommandChat.tsx` | Fix scroll effect deps, extract MessageBubble, formatter cache |
| `frontend/src/components/chat/MarkdownBody.tsx` | Hoist remarkPlugins + components to module-level constants |
| `frontend/src/App.tsx` | Extract ChatBadge from AppContent |
| `frontend/src/hooks/useAudioNotifications.ts` | Named listeners + cleanup + audio.src clearing |
| `frontend/src/hooks/useVoicePlayer.ts` | try/catch cleanup on play() failure |
| `frontend/src/hooks/useMobileAudio.ts` | Clear audio.src on completion |
| `frontend/src/hooks/useTimeline.ts` | Cap events array at 1000 |
| `frontend/src/hooks/useTerminalStream.ts` | Ring-buffer content at 100KB |
| `frontend/src/hooks/useDashboard.ts`, `useProjectOverview.ts` | Stabilize polling deps via ref pattern |
| `frontend/src/components/dashboard/OverviewDashboard.tsx` | Stabilize polling interval deps |
| `frontend/package.json` | Add `react-virtuoso` |
| `frontend/src/components/chat/CommandChat.tsx` | Wrap message list in Virtuoso |
| `frontend/src/components/timeline/TimelineView.tsx` | Wrap in Virtuoso, move inline `<style>` to external CSS |
| `frontend/src/components/timeline/TimelineEventCard.tsx` | Add React.memo |
| `frontend/src/components/beads/BeadsList.tsx` | TableVirtuoso, extract BeadRow with memo, lift inline styles |
| `frontend/src/components/crew/SwarmAgentCard.tsx` | Add React.memo |
| `frontend/src/styles/CRTScreen.css` | Reduce filter scope, slow scanlines or static gradient |
| `frontend/src/components/timeline/timeline.css` | (new) Move TimelineView inline keyframes here |
| `frontend/src/utils/dateFormatter.ts` | (new) Singleton Intl formatters + LRU cache |
| `frontend/tests/perf/leak-overview.test.ts` | (new) Puppeteer heap regression |
| `frontend/tests/perf/keystroke-latency.test.ts` | (new) Latency budget |
| `frontend/perf-budgets.md` | (new) Documented thresholds |
| `README.md` | Add perf-testing instructions |

## Phase 1: Track A — Communication Layer Refactor (P0)

**Why first**: Every other render fix is meaningless if the context still invalidates on every WS frame. This is the bottleneck. Must land before Track B touches CommandChat to avoid merge conflicts.

Splits CommunicationContext into two contexts. Adds client-side `seq` tracking with dedup. Adds `sync_response` handler. Plugs the SSE 'connected' listener leak. Adds mutual exclusion between WS and SSE channels.

## Phase 2: Track B — Chat Page Render Storm Fix (P0)

**Why second**: Direct cure for the 30s+ typing lag. Builds on the split context from Phase 1 — `CommandChat` and child bubbles now subscribe only to stable actions, not status updates.

Fixes scroll effect deps. Extracts memoized `MessageBubble`. Hoists Markdown plugin constants. Extracts `<ChatBadge>` from AppContent. Singleton formatter cache.

## Phase 3: Track C — Memory Leak Eradication (P0, parallel with Phase 2)

**Why parallel with B**: Different files, no overlap. C touches hooks (audio, timeline, terminal, polling); B touches CommandChat + App.tsx.

Plugs audio leaks (useAudioNotifications, useVoicePlayer, useMobileAudio). Caps useTimeline events array. Ring-buffers useTerminalStream content. Stabilizes polling interval dependencies.

## Phase 4: Track D — List Virtualization + Memoization (P1, after Phases 1+2)

**Why after B**: CommandChat structural changes from B simplify the virtualization wrapping. Avoids merge conflicts.

Installs react-virtuoso. Virtualizes chat messages, BeadsList table, TimelineView. Memoizes TimelineEventCard, SwarmAgentCard, BeadRow. Lifts hot-path inline styles to CSS classes.

## Phase 5: Track E — CSS/Animation Cost Reduction (P2, independent)

**Why independent**: Pure CSS, no React state intersection. Can run any time.

Reduces CRT filter scope. Slows scanline animation (or converts to static gradient). Moves TimelineView inline `<style>` to external CSS. Narrows `transition: all`.

## Phase 6: Track F — Verification Harness (P1, depends on all)

**Why last**: Budgets are measured against the new baseline, not the old.

Documents perf budgets. Adds Puppeteer leak regression test. Adds keystroke latency benchmark. Updates README + CLAUDE.md with perf-testing instructions (production build, not dev).

## Parallel Execution

```
Time →
[Phase 1: Track A] ────────┐
                            ├── [Phase 2: Track B]
                            │      ├──┐
                            │      │  └── [Phase 4: Track D]
                            └── [Phase 3: Track C]
                                       │
[Phase 5: Track E] ──────────────────  │
                                       │
                                       └── [Phase 6: Track F]
```

- **Phase 1 (Track A)**: Solo (1 agent). Blocks Phase 2.
- **Phase 2 (Track B)** & **Phase 3 (Track C)** & **Phase 5 (Track E)**: Parallel (3 agents).
- **Phase 4 (Track D)**: After Phase 2 lands.
- **Phase 6 (Track F)**: After Phases 2-5 land.

## Verification Steps

- [ ] Type 100 characters into chat with 10 agents firing — measure p99 keystroke latency < 50ms
- [ ] Leave overview page open for 30 min — heap grows < 30MB total
- [ ] Toggle communication priority 50 times — heap returns to baseline within 10s
- [ ] Reconnect WS 10 times with 50 messages buffered — zero duplicates in UI
- [ ] Open BeadsList with 500 beads — initial paint < 100ms, scroll FPS ≥ 55
- [ ] Run `npm run build && npm test` — all tests green
- [ ] React DevTools Profiler: single incoming message triggers ≤ 3 re-renders
