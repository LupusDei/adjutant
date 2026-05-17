# Feature Specification: Adjutant Frontend Performance Overhaul

**Feature Branch**: `054-frontend-performance-overhaul`
**Created**: 2026-05-17
**Status**: Draft
**Epic**: `adj-139`
**Priority**: P0

## Problem Statement

The Adjutant web dashboard is unusable under sustained load:

1. **Overview page**: sitting idle eventually OOMs the browser tab. Memory grows linearly with WS messages, audio notifications, timeline events, and polling churn.
2. **Chat page**: typing a single character in the input takes **30+ seconds** to display. Repeated "operation installed" notifications appear. Pages load slowly.
3. **All lists** (chat messages, beads, timeline events, agent cards) render every row into the DOM with no virtualization. With 500+ items, parent re-renders cascade catastrophically.

Root cause is a **compound failure**: an unstable context value at the heart of the real-time communication layer fans re-renders across the entire component tree, while uncapped state arrays, leaked event listeners, and unmemoized lists multiply the cost of each render.

## User Scenarios & Testing

### User Story 1 - Typing in chat is instant (Priority: P0, MVP)

User opens the chat page, types a message into the input. Each character appears within one frame (<16ms). Sending the message is immediate. Other agents sending messages during typing does not block the keystroke pipeline.

**Why this priority**: This is the most user-visible failure. The current 30s+ lag makes the chat unusable.

**Independent Test**: Spin up the dashboard with 10 active agents emitting 2-5 msgs/sec. Open the chat page, type "the quick brown fox jumps over the lazy dog" continuously. Measure keystroke → display latency via the Performance panel. Target: p99 < 50ms, p50 < 16ms.

**Acceptance Scenarios**:

1. **Given** 10 agents emitting messages, **When** the user types in the chat input, **Then** each character displays within one frame.
2. **Given** the user sends a message while another arrives via WS, **When** the optimistic message is rendered, **Then** no duplicate appears and no flicker is visible.
3. **Given** the connection drops and reconnects, **When** the server replays buffered messages, **Then** none are duplicated in the UI.

---

### User Story 2 - Overview page runs for hours without crashing (Priority: P0)

User opens the overview/dashboard page and leaves it in a background tab. Memory usage stays stable. After 8 hours the tab is still responsive and consuming less than 200MB heap.

**Why this priority**: Tab crashes destroy in-progress work and erode trust in the tool.

**Independent Test**: Puppeteer script opens the overview page, lets it run for 10 minutes with active agents, captures heap snapshots at 0/2/5/10 minutes. Assert heap growth < 5MB per 5min interval.

**Acceptance Scenarios**:

1. **Given** the overview page is open for 1 hour, **When** the user inspects memory, **Then** heap is < 100MB.
2. **Given** the user toggles communication priority 50 times, **When** the user inspects active event listeners, **Then** no leaked SSE/WS listeners remain.
3. **Given** 100 audio notifications are played, **When** the user inspects audio elements, **Then** all Audio objects have been released and `src` cleared.

---

### User Story 3 - Long lists scroll smoothly (Priority: P1)

User opens BeadsList with 500+ beads, the chat with 1000+ messages, or the timeline with 1000+ events. Scrolling is smooth at 60fps. Initial render completes in under 100ms.

**Why this priority**: Scaling failure. Existing users with large histories cannot use these views today.

**Independent Test**: Seed local DB with 1000 messages, 500 beads, 1000 timeline events. Open each view, scroll continuously for 30s. Verify no dropped frames in DevTools Performance panel.

**Acceptance Scenarios**:

1. **Given** 1000 chat messages, **When** the user scrolls the message list, **Then** scroll runs at 60fps with no jank.
2. **Given** 500 beads, **When** the user opens BeadsList, **Then** initial render completes within 100ms.
3. **Given** the parent component re-renders, **When** only one bead's data changed, **Then** only that row re-renders (verified via React Profiler).

---

### User Story 4 - Notifications and animations don't tax the GPU (Priority: P2)

User leaves the dashboard open. The CRT phosphor effect, scanlines, and glow animations run continuously without measurable battery/CPU impact.

**Why this priority**: Quality-of-life. Reduces fan noise and battery drain.

**Independent Test**: With Chrome's Rendering panel, observe paint flashing on the dashboard. Verify scanline animation does not cause full-page repaints.

**Acceptance Scenarios**:

1. **Given** the dashboard is open, **When** the user opens Chrome Rendering panel, **Then** scanlines do not cause whole-screen repaints.
2. **Given** the user has the chat open for 1 hour, **When** the user checks Activity Monitor, **Then** the tab's GPU usage is < 5%.

---

### User Story 5 - Verification harness catches regressions (Priority: P1)

Future changes are protected by automated performance budgets and a memory-leak regression test. Build fails if budgets regress beyond threshold.

**Why this priority**: Without guardrails, performance work decays.

**Independent Test**: Run the perf test suite. Intentionally introduce a memory leak (push to an unbounded array). Verify the test fails.

**Acceptance Scenarios**:

1. **Given** a perf budget exists (`< 50ms p99 keystroke latency`), **When** a regression is introduced, **Then** the test suite flags it.
2. **Given** the leak regression test exists, **When** a hook stops cleaning up listeners, **Then** the test detects heap growth and fails.

---

### Edge Cases

- WS reconnect while user is mid-keystroke: should not block input.
- Audio notification fires while chat is open: should not delay rendering.
- 50 agents firing messages simultaneously: state updates must batch.
- Switching between projects rapidly: polling intervals must not stack.
- Browser tab backgrounded: polling must pause via `document.visibilityState`.
- WS frame contains 100 messages in `sync_response`: must be unpacked, deduped by `seq`, and rendered without re-render storm.

## Requirements

### Functional Requirements

- **FR-001**: CommunicationContext MUST split into two contexts: a stable `CommunicationActionsContext` (sendMessage, subscribe, subscribeTimeline) and a volatile `CommunicationStatusContext` (connectionStatus, priority). Components consume only what they need.
- **FR-002**: The client MUST track `seq` of last processed message in a ref. On reconnect, send `lastSeqSeen` to the server. Messages with `seq <= lastSeenSeq` MUST be dropped.
- **FR-003**: The client MUST handle `sync_response` frames by unpacking `missed[]`, dedupe by `seq`, and dispatch each contained `chat_message` to subscribers.
- **FR-004**: All `setInterval`/`setTimeout`/`addEventListener`/`new EventSource`/`new WebSocket`/`new Audio` resources MUST be cleaned up in their respective `useEffect` cleanup functions or `finally` blocks. Anonymous handlers MUST be assigned to a named reference so they can be unregistered.
- **FR-005**: All state arrays representing append-only event streams (messages, timeline events, terminal content) MUST be capped at a configured maximum (default 1000) with FIFO eviction.
- **FR-006**: Chat message list, BeadsList table, and TimelineView event list MUST use list virtualization (react-virtuoso). Only visible rows are mounted.
- **FR-007**: Row components for messages, beads, timeline events, and agent cards MUST be `React.memo`'d with custom equality functions based on id + status fields.
- **FR-008**: `MarkdownBody` MUST use module-level constants for `remarkPlugins` and `components` to preserve memoization.
- **FR-009**: `Intl.DateTimeFormat` and other expensive formatters MUST be instantiated once per locale/option combination via a singleton registry.
- **FR-010**: CRT visual effects (filter, scanlines) MUST NOT trigger whole-screen GPU recompositing on every paint. Static patterns SHOULD use `background-image` over animated `filter`.
- **FR-011**: A documented performance budget MUST exist with measurable thresholds: keystroke latency p99 < 50ms, heap growth < 5MB / 5min idle, scroll FPS ≥ 55, initial paint < 100ms.
- **FR-012**: A Puppeteer-based memory-leak regression test MUST run in CI on every PR touching frontend code.

### Key Files

- **CommunicationContext** (`frontend/src/contexts/CommunicationContext.tsx`) — Single source of WS/SSE/polling state, currently the primary bottleneck.
- **CommandChat** (`frontend/src/components/chat/CommandChat.tsx`) — Renders the message list and input; primary keystroke lag site.
- **MarkdownBody** (`frontend/src/components/chat/MarkdownBody.tsx`) — Per-message markdown rendering.
- **OverviewDashboard** (`frontend/src/components/dashboard/OverviewDashboard.tsx`) — Top-level overview view with polling.
- **useAudioNotifications** (`frontend/src/hooks/useAudioNotifications.ts`) — Audio notification leak source.
- **useTimeline** (`frontend/src/hooks/useTimeline.ts`) — Uncapped events array.
- **useTerminalStream** (`frontend/src/hooks/useTerminalStream.ts`) — Uncapped terminal content.
- **CRTScreen.css** (`frontend/src/styles/CRTScreen.css`) — Visual effects causing GPU thrash.
- **BeadsList** (`frontend/src/components/beads/BeadsList.tsx`) — 500-row table without virtualization.
- **TimelineView** (`frontend/src/components/timeline/TimelineView.tsx`) — Uncapped event list with inline `<style>`.

## Success Criteria

- **SC-001**: Keystroke → display latency p99 < 50ms with 10 agents at 2-5 msg/sec.
- **SC-002**: Overview page heap stays < 100MB after 1 hour idle, < 200MB after 8 hours.
- **SC-003**: Chat with 1000 messages renders initial paint in < 100ms; scroll FPS ≥ 55.
- **SC-004**: Zero leaked event listeners after 100 priority-toggle cycles (verified via DevTools Memory Inspector).
- **SC-005**: Zero duplicate messages across 10 reconnect cycles.
- **SC-006**: `npm run build && npm run preview` runs the regression test suite green, including the Puppeteer leak test.
- **SC-007**: React DevTools Profiler shows a single message render triggers ≤ 3 component re-renders (was 50+ before).
