# Tasks: Adjutant Frontend Performance Overhaul

**Input**: Design documents from `/specs/054-frontend-performance-overhaul/`
**Epic**: `adj-139`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs.
- **Bead IDs** (adj-139.N.M): Tracking IDs (see beads-import.md).
- **[P]**: Different files, no deps — safe to run in parallel.
- **[US]**: User story label.

---

## Phase 1: Track A — Communication Layer Refactor (Priority: P0)

**Goal**: Eliminate the context invalidation that fans re-renders on every WS frame; correctly handle reconnect/replay; plug listener leaks in the comm layer.
**Independent Test**: With React Profiler, observe that an incoming chat_message no longer triggers a re-render in components that don't use connectionStatus.

- [ ] T001a [US1] Write failing tests for split CommunicationContext in `frontend/tests/unit/CommunicationContext.test.tsx`. Cover: (a) consumer of Actions context does NOT re-render when connectionStatus changes, (b) consumer of Status context DOES re-render, (c) sendMessage/subscribe identity is stable across status changes. Confirm RED.
- [ ] T001b [US1] Split `CommunicationContext.tsx` into `CommunicationActionsContext` (sendMessage, subscribe, subscribeTimeline) and `CommunicationStatusContext` (connectionStatus, priority, setPriority). Export two hooks: `useCommunicationActions()` and `useCommunicationStatus()`. Keep a backward-compat `useCommunication()` that returns both for migration. Run T001a tests to GREEN.
- [ ] T002a [P] [US1] Write failing tests in `frontend/tests/unit/CommunicationContext.seq.test.tsx` for client-side seq tracking: (a) message with seq <= lastSeen is dropped, (b) message with seq > lastSeen updates lastSeen, (c) on 'connected' frame, lastSeq from server is recorded. Confirm RED.
- [ ] T002b [US1] Add `lastProcessedSeqRef: useRef<number>` in `CommunicationContext.tsx:~133`. In 'connected' handler at line 267, set `lastProcessedSeqRef.current = msg.lastSeq ?? 0`. In the chat_message handler at line 279, drop if `msg.seq && msg.seq <= lastProcessedSeqRef.current`, else update. Send `lastSeqSeen: lastProcessedSeqRef.current` in reconnect/sync requests. Run T002a tests to GREEN.
- [ ] T003a [P] [US1] Write failing tests in `frontend/tests/unit/CommunicationContext.sync.test.tsx` for `sync_response` handling: (a) `missed[]` array is unpacked, (b) each item with `seq > lastSeen` is dispatched to subscribers, (c) duplicates by `seq` are dropped. Confirm RED.
- [ ] T003b [US1] In `CommunicationContext.tsx` WS `onmessage` switch (~line 251), add `case 'sync_response':` that iterates `msg.missed`, dedups by `seq`, calls `notify()` per item. Run T003a tests to GREEN.
- [ ] T004 [US1] Fix reconnect timer leak in `CommunicationContext.tsx:~327`. Write failing test asserting `setTimeout` is only called once per disconnect (in `frontend/tests/unit/CommunicationContext.reconnect.test.tsx`). Confirm RED. Then ensure `clearTimeout(reconnectTimerRef.current)` is invoked before assignment in every branch. Run test to GREEN.
- [ ] T005 [US1] Fix SSE 'connected' listener leak in `CommunicationContext.tsx:215`. Write failing test in `frontend/tests/unit/CommunicationContext.sse-leak.test.tsx` that toggles priority 10 times and asserts no listener accumulation (use a spy on `EventSource.prototype.addEventListener` / `removeEventListener`). Confirm RED. Replace anonymous `addEventListener('connected', ...)` with a named handler and call `removeEventListener` before `es.close()`. Run test to GREEN.
- [ ] T006 [US1] WS/SSE mutual exclusion in `CommunicationContext.tsx:194-229`. Write failing test asserting at most one of `wsRef.current`/`sseRef.current` is non-null at any time. Confirm RED. In `startWebSocket()` close any open SSE first; in `startSSE()` close any open WS first. Run test to GREEN.

**Checkpoint**: Track A complete — context split, seq tracked, sync handled, leaks plugged.

---

## Phase 2: Track B — Chat Page Render Storm Fix (Priority: P0)

**Goal**: Reduce keystroke → display latency from 30s+ to < 50ms p99.
**Independent Test**: Type 100 chars in chat with 10 agents firing; measure p99 latency via Performance API.
**Depends on**: Phase 1 (Track A) — uses `useCommunicationActions()`.

- [ ] T007a [P] [US1] Write failing tests in `frontend/tests/unit/CommandChat.scroll.test.tsx`: (a) typing in input does NOT trigger scrollToBottom, (b) new message appended DOES trigger scrollToBottom, (c) scroll fires at most once per 100ms when multiple messages arrive. Confirm RED.
- [ ] T007b [US1] In `CommandChat.tsx:236-238`, change effect deps from `[messages, streamingMessages, scrollToBottom]` to `[messages.length, streamingMessages.size]`. Wrap `scrollToBottom` in a 100ms debounce or `requestAnimationFrame` batch. Run T007a tests to GREEN.
- [ ] T008a [P] [US1] Write failing tests in `frontend/tests/unit/MessageBubble.test.tsx` for an extracted `MessageBubble` component: (a) memoized — does not re-render when parent re-renders with same props, (b) re-renders when streaming content changes, (c) memo cache key uses `msg.id + (streamingContent?.length ?? 0)`. Confirm RED.
- [ ] T008b [US1] Extract `MessageBubble` from `CommandChat.tsx:480-550` to `frontend/src/components/chat/MessageBubble.tsx`. Wrap with `React.memo` and a custom equality fn. Pass all callbacks as memoized refs. Run T008a tests to GREEN.
- [ ] T009 [P] [US1] Hoist `remarkPlugins` array and `components` object in `MarkdownBody.tsx:16-25` to module-level constants `REMARK_PLUGINS` and `MARKDOWN_COMPONENTS`. Write a failing test in `frontend/tests/unit/MarkdownBody.test.tsx` that verifies `React.memo` blocks re-render when `children` is unchanged. Confirm RED. Apply the hoist. Run test to GREEN.
- [ ] T010 [P] [US1] Extract `<ChatBadge />` from `App.tsx:87-202` (AppContent). The badge component should be the only subscriber to `useUnreadCounts()`. Write a failing test in `frontend/tests/unit/AppContent.test.tsx` asserting AppContent does not re-render when unread count changes. Confirm RED. Move `useUnreadCounts()` into a new `frontend/src/components/chat/ChatBadge.tsx`. Run test to GREEN.
- [ ] T011a [P] [US1] Write failing tests for singleton formatter cache in `frontend/tests/unit/dateFormatter.test.ts`: (a) same locale+options returns identical instance across calls, (b) cached `format` result for same Date input is identical reference. Confirm RED.
- [ ] T011b [US1] Create `frontend/src/utils/dateFormatter.ts` exporting `getTimeFormatter(locale, options)` (singleton Map keyed by JSON) and `formatDateCached(dateStr, formatter)` with LRU cache of size 1000. Run T011a tests to GREEN.
- [ ] T012 [US1] Replace `new Intl.DateTimeFormat(...)` and `new Date(...)` in `CommandChat.tsx:44-70` with the cached helpers from T011b. Verify with a perf test in `frontend/tests/perf/formatter-cache.test.ts` that formatting 10k messages drops from > 100ms to < 5ms. Confirm RED on the perf threshold, then GREEN.

**Checkpoint**: Chat input lag eliminated. User Story 1 acceptance achievable.

---

## Phase 3: Track C — Memory Leak Eradication (Priority: P0)

**Goal**: Eliminate the unbounded growth that crashes the overview page.
**Independent Test**: Puppeteer leak regression test (added in Phase 6).
**Runs in parallel with Phase 2.**

- [ ] T013a [P] [US2] Write failing tests in `frontend/tests/unit/useAudioNotifications.test.ts` for cleanup: (a) after notification ends, no event listeners remain on the Audio element, (b) `audio.src` is cleared, (c) playing 50 notifications does not leak audio objects in WeakRef tracking. Confirm RED.
- [ ] T013b [US2] In `useAudioNotifications.ts:128-148`, replace anonymous listeners with named handlers `handleEnded`, `handleError`. In both handlers add `audio.pause(); audio.removeEventListener('ended', handleEnded); audio.removeEventListener('error', handleError); audio.src = '';`. Also clean up in the hook's unmount cleanup. Run T013a tests to GREEN.
- [ ] T014a [P] [US2] Write failing tests in `frontend/tests/unit/useVoicePlayer.test.ts` for error-path cleanup: when `audio.play()` rejects, all 6 listeners are removed before promise resolves. Confirm RED.
- [ ] T014b [US2] In `useVoicePlayer.ts:139-156`, wrap `await audio.play()` in try/catch. On catch, call the cleanup ref (which removes all listeners) before re-throwing. Run T014a tests to GREEN.
- [ ] T015 [P] [US2] In `useMobileAudio.ts:229`, add `audio.src = ''` in the `ended`/`error` listeners after `setIsPlaying(false)`. Write a failing test in `frontend/tests/unit/useMobileAudio.test.ts` that the shared audio's src is empty between plays. Confirm RED, then GREEN.
- [ ] T016a [P] [US2] Write failing tests in `frontend/tests/unit/useTimeline.test.ts`: (a) events array is capped at 1000 entries, (b) prepending the 1001st event evicts the oldest, (c) loadMore respects the cap. Confirm RED.
- [ ] T016b [US2] In `useTimeline.ts:120-154`, after every `setEvents` mutation slice to at most 1000 entries. Add a `MAX_TIMELINE_EVENTS` constant. Run T016a tests to GREEN.
- [ ] T017a [P] [US2] Write failing tests in `frontend/tests/unit/useTerminalStream.test.ts` for content ring buffer: (a) content never exceeds 100KB, (b) appending past 100KB drops the oldest lines, (c) line boundaries are preserved (no mid-line truncation). Confirm RED.
- [ ] T017b [US2] In `useTerminalStream.ts:147`, replace `prev ? prev + '\n' + newText : newText` with a ring-buffer helper that caps at 100KB and respects line boundaries. Run T017a tests to GREEN.
- [ ] T018a [US2] Write failing tests in `frontend/tests/unit/useDashboardPolling.test.tsx`: (a) polling interval is created exactly once on mount and cleared on unmount, (b) `activeProjectId` changing does NOT recreate the interval, only updates the next fetch's project. Confirm RED.
- [ ] T018b [US2] Stabilize polling in `OverviewDashboard.tsx:156-188`, `useOverview.ts`, `useDashboard.ts` by storing the latest `activeProjectId` / fetch callback in a ref and reading it inside `setInterval`'s closure. Remove `activeProjectId` and `fetchAutoDevelopStatus` from effect deps. Run T018a tests to GREEN.
- [ ] T019 [P] [US2] In `CommunicationContext.tsx:130-131`, add dev-only diagnostic: if subscriber Set size exceeds 50, console.warn with stack hint. Write failing test in `frontend/tests/unit/CommunicationContext.subscribers.test.tsx` asserting warning fires past threshold. Confirm RED. Add code under `if (import.meta.env.DEV)`. Run test to GREEN.

**Checkpoint**: All known memory leaks plugged. User Story 2 acceptance achievable.

---

## Phase 4: Track D — List Virtualization + Memoization (Priority: P1)

**Goal**: All major lists render only visible rows; rows do not re-render on unrelated parent updates.
**Independent Test**: Open chat with 1000 messages, scroll continuously, verify ≥ 55fps. Open BeadsList with 500 beads, initial paint < 100ms.
**Depends on**: Phases 1 + 2 (uses split context, memoized MessageBubble).

- [ ] T020 [setup] [US3] Add `react-virtuoso` to `frontend/package.json` and run `npm install`. Verify import works in a smoke test `frontend/tests/unit/virtuoso-smoke.test.tsx`. (Exempt from TDD shape — dependency install.)
- [ ] T021a [P] [US3] Write failing tests in `frontend/tests/unit/CommandChat.virtualized.test.tsx`: (a) with 1000 messages, at most ~30 DOM bubbles are mounted, (b) auto-scroll-to-bottom still works on new message, (c) scrolling up loads older messages via existing IntersectionObserver. Confirm RED.
- [ ] T021b [US3] Replace `messages.map(...)` in `CommandChat.tsx:480-550` with `<Virtuoso>` from react-virtuoso. Use `followOutput="smooth"` for auto-scroll. Use `startReached` callback for loadMore. Run T021a tests to GREEN.
- [ ] T022 [P] [US3] Add `React.memo` to `TimelineEventCard.tsx:39` with equality `(prev, next) => prev.event.id === next.event.id && prev.isNew === next.isNew`. Write a failing test in `frontend/tests/unit/TimelineEventCard.test.tsx` that a parent re-render with unchanged props does not re-render the card. Confirm RED, then GREEN.
- [ ] T023a [P] [US3] Write failing test in `frontend/tests/unit/TimelineView.virtualized.test.tsx`: 1000 events → at most ~30 cards mounted. Confirm RED.
- [ ] T023b [US3] Wrap the events list in `TimelineView.tsx:135-150` with `<Virtuoso>` preserving date-group headers via `groupCounts` / `topItemCount` API. Run T023a test to GREEN.
- [ ] T024a [P] [US3] Write failing test in `frontend/tests/unit/BeadsList.virtualized.test.tsx`: with 500 beads, at most ~30 rows mounted. Confirm RED.
- [ ] T024b [US3] Extract `BeadRow` component from `BeadsList.tsx:483-601` with `React.memo`. Replace inline rows with `<TableVirtuoso>` from react-virtuoso. Preserve grouping (top-pinned group headers via `fixedHeaderContent`). Run T024a test to GREEN.
- [ ] T025 [P] [US3] Add `React.memo` to `SwarmAgentCard.tsx` with equality fn keyed on agent.id + agent.status + agent.lastActivityAt. Write a failing test `frontend/tests/unit/SwarmAgentCard.test.tsx` that parent re-render with unchanged agent does not re-render the card. Confirm RED, then GREEN.
- [ ] T026 [US3] Lift hot-path inline styles in `BeadsList.tsx` (lines 500-504, 522, 509) and `SwarmAgentCard.tsx` to CSS classes or `useMemo`'d style objects. Write a failing test asserting style reference is stable across renders with same inputs. Confirm RED, then GREEN.

**Checkpoint**: User Story 3 acceptance achievable.

---

## Phase 5: Track E — CSS/Animation Cost Reduction (Priority: P2)

**Goal**: CRT effects no longer cause whole-screen GPU recompositing.
**Independent Test**: Chrome Rendering panel shows no full-page paint flashing on scanline animation.
**Independent of other phases.**

- [ ] T027 [P] [US4] In `frontend/src/styles/CRTScreen.css:261-270`, scope the `.crt-phosphor` `filter: contrast/brightness` to a smaller layer or replace with `will-change: transform` + a static texture. Verify with Chrome Rendering panel manually (document the verification in PR). (Exempt from TDD — purely visual.)
- [ ] T028 [P] [US4] In `CRTScreen.css:307-330`, slow scanline animation from `0.05s steps(2)` to `0.5s` OR convert to a static `background-image: repeating-linear-gradient(...)` — measure FPS impact and choose the static variant if visually acceptable. Document choice in PR. (Exempt from TDD.)
- [ ] T029 [P] [US4] Move inline `<style>{...}` from `TimelineView.tsx:166-171` to a new `frontend/src/components/timeline/timeline.css` file. Import the CSS module from the component. Write failing test `frontend/tests/unit/TimelineView.style.test.tsx` asserting no `<style>` tag appears in the rendered output. Confirm RED, then GREEN.
- [ ] T030 [P] [US4] In `frontend/src/styles/chat.css`, narrow every `transition: all 0.15s ease` to specific properties (`background-color`, `border-color`, `box-shadow`). (Exempt from TDD — visual; document selectors changed in PR.)

**Checkpoint**: User Story 4 acceptance achievable.

---

## Phase 6: Track F — Verification Harness (Priority: P1)

**Goal**: Performance budgets are documented and enforced by automated regression tests.
**Independent Test**: Intentionally regress one fix; verify the test suite catches it.
**Depends on**: All prior phases (budgets are measured against post-fix baseline).

- [ ] T031 [docs] [US5] Create `frontend/perf-budgets.md` documenting: keystroke p99 < 50ms, heap < 100MB after 1h, heap growth < 5MB/5min, initial paint < 100ms, scroll FPS ≥ 55. (Exempt from TDD — docs.)
- [ ] T032a [US5] Write failing Puppeteer test in `frontend/tests/perf/leak-overview.test.ts`: open overview page, wait 60s, capture heap snapshot, repeat 3 times, assert each interval's growth < 10MB. Confirm RED initially (test framework not yet present).
- [ ] T032b [US5] Implement the leak regression test using Puppeteer. Add `npm run test:perf` script to `frontend/package.json`. Run on a production build (`vite build && vite preview`). Run T032a to GREEN against the fixed code from Phases 1-5.
- [ ] T033a [P] [US5] Write failing test in `frontend/tests/perf/keystroke-latency.test.ts` (Puppeteer): seed 500 messages, type 50 chars, measure input → display latency via Performance API timestamps. Assert p99 < 50ms. Confirm RED.
- [ ] T033b [US5] Implement keystroke latency test. Hook into the build pipeline if feasible (skip in CI behind `RUN_PERF=1` env var to avoid flakiness on shared runners). Run T033a to GREEN.
- [ ] T034 [docs] [US5] Update `README.md` and `CLAUDE.md` with a section "Performance testing" that documents `npm run build && npm run preview` is required for accurate perf measurement (not `npm run dev`). Reference `frontend/perf-budgets.md`. (Exempt from TDD — docs.)

**Checkpoint**: User Story 5 acceptance achievable. Epic ready for closure.

---

## Dependencies

- Phase 1 (Track A) blocks Phase 2 (Track B) — split context API used by chat.
- Phase 1 + Phase 2 block Phase 4 (Track D) — virtualization wraps the memoized MessageBubble from B.
- Phase 3 (Track C) parallel with Phase 2 (Track B) — different files.
- Phase 5 (Track E) independent — pure CSS.
- Phase 6 (Track F) depends on all prior — budgets measured against post-fix baseline.
- For TDD-split pairs: Tb depends on Ta within the same base number.

## Parallel Opportunities

After Phase 1 closes:
- Engineer A: Phase 2 (Track B)
- Engineer B: Phase 3 (Track C)
- Engineer C: Phase 5 (Track E)

After Phase 2 closes:
- Engineer A or D: Phase 4 (Track D)

After all close:
- Engineer A or QA: Phase 6 (Track F)

QA Sentinel runs after every phase merge to verify perf budgets do not regress (uses Phase 6 harness once it exists).
