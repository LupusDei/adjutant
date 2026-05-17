# Adjutant Frontend Performance Overhaul - Beads

**Feature**: 054-frontend-performance-overhaul
**Generated**: 2026-05-17
**Source**: specs/054-frontend-performance-overhaul/tasks.md

## Root Epic

- **ID**: adj-139
- **Title**: Frontend Performance Overhaul
- **Type**: epic
- **Priority**: 0
- **Description**: Compound performance failure across the Adjutant frontend (30s+ chat input lag, overview-page OOM crashes, "operation installed" duplicate notifications, unvirtualized lists). Six-track fix: split CommunicationContext, plug memory leaks, virtualize lists, reduce CRT GPU cost, regression harness.

## Epics

### Phase 1 — Track A: Communication Layer Refactor
- **ID**: adj-139.1
- **Type**: epic
- **Priority**: 0
- **Blocks**: adj-139.2, adj-139.4
- **Tasks**: 6

### Phase 2 — Track B: Chat Page Render Storm Fix
- **ID**: adj-139.2
- **Type**: epic
- **Priority**: 0
- **MVP**: true
- **Depends**: adj-139.1
- **Blocks**: adj-139.4
- **Tasks**: 6

### Phase 3 — Track C: Memory Leak Eradication
- **ID**: adj-139.3
- **Type**: epic
- **Priority**: 0
- **Tasks**: 7

### Phase 4 — Track D: List Virtualization + Memoization
- **ID**: adj-139.4
- **Type**: epic
- **Priority**: 1
- **Depends**: adj-139.1, adj-139.2
- **Tasks**: 7

### Phase 5 — Track E: CSS/Animation Cost Reduction
- **ID**: adj-139.5
- **Type**: epic
- **Priority**: 2
- **Tasks**: 4

### Phase 6 — Track F: Verification Harness
- **ID**: adj-139.6
- **Type**: epic
- **Priority**: 1
- **Depends**: adj-139.2, adj-139.3, adj-139.4, adj-139.5
- **Tasks**: 4

## Tasks

### Phase 1 — Track A: Communication Layer Refactor

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Split CommunicationContext into Actions + Status | frontend/src/contexts/CommunicationContext.tsx | adj-139.1.1 |
| T002 | Client-side seq tracking + dedup | frontend/src/contexts/CommunicationContext.tsx | adj-139.1.2 |
| T003 | sync_response handler | frontend/src/contexts/CommunicationContext.tsx | adj-139.1.3 |
| T004 | Reconnect timer cleared before reset | frontend/src/contexts/CommunicationContext.tsx | adj-139.1.4 |
| T005 | SSE 'connected' listener leak fix | frontend/src/contexts/CommunicationContext.tsx | adj-139.1.5 |
| T006 | WS/SSE mutual exclusion | frontend/src/contexts/CommunicationContext.tsx | adj-139.1.6 |

### Phase 2 — Track B: Chat Page Render Storm Fix

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T007 | Scroll-to-bottom effect deps + debounce | frontend/src/components/chat/CommandChat.tsx | adj-139.2.1 |
| T008 | Extract memoized MessageBubble | frontend/src/components/chat/MessageBubble.tsx | adj-139.2.2 |
| T009 | Hoist MarkdownBody plugin constants | frontend/src/components/chat/MarkdownBody.tsx | adj-139.2.3 |
| T010 | Extract ChatBadge from AppContent | frontend/src/components/chat/ChatBadge.tsx | adj-139.2.4 |
| T011 | Singleton Intl formatter cache | frontend/src/utils/dateFormatter.ts | adj-139.2.5 |
| T012 | Replace per-message Date/Intl in CommandChat | frontend/src/components/chat/CommandChat.tsx | adj-139.2.6 |

### Phase 3 — Track C: Memory Leak Eradication

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T013 | useAudioNotifications cleanup | frontend/src/hooks/useAudioNotifications.ts | adj-139.3.1 |
| T014 | useVoicePlayer error-path cleanup | frontend/src/hooks/useVoicePlayer.ts | adj-139.3.2 |
| T015 | useMobileAudio src clearing | frontend/src/hooks/useMobileAudio.ts | adj-139.3.3 |
| T016 | Cap useTimeline events array | frontend/src/hooks/useTimeline.ts | adj-139.3.4 |
| T017 | Ring-buffer useTerminalStream content | frontend/src/hooks/useTerminalStream.ts | adj-139.3.5 |
| T018 | Stabilize polling deps via ref | frontend/src/hooks/useDashboard.ts + useProjectOverview.ts + OverviewDashboard.tsx | adj-139.3.6 |
| T019 | Subscriber Set leak diagnostic | frontend/src/contexts/CommunicationContext.tsx | adj-139.3.7 |

### Phase 4 — Track D: List Virtualization + Memoization

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T020 | Install react-virtuoso | frontend/package.json | adj-139.4.1 |
| T021 | Virtualize CommandChat message list | frontend/src/components/chat/CommandChat.tsx | adj-139.4.2 |
| T022 | Memoize TimelineEventCard | frontend/src/components/timeline/TimelineEventCard.tsx | adj-139.4.3 |
| T023 | Virtualize TimelineView | frontend/src/components/timeline/TimelineView.tsx | adj-139.4.4 |
| T024 | Virtualize BeadsList table | frontend/src/components/beads/BeadsList.tsx | adj-139.4.5 |
| T025 | Memoize SwarmAgentCard | frontend/src/components/crew/SwarmAgentCard.tsx | adj-139.4.6 |
| T026 | Lift hot-path inline styles | frontend/src/components/beads/BeadsList.tsx + SwarmAgentCard.tsx | adj-139.4.7 |

### Phase 5 — Track E: CSS/Animation Cost Reduction

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T027 | Reduce CRT phosphor filter scope | frontend/src/styles/CRTScreen.css | adj-139.5.1 |
| T028 | Slow/static scanlines | frontend/src/styles/CRTScreen.css | adj-139.5.2 |
| T029 | Move TimelineView inline style to CSS | frontend/src/components/timeline/timeline.css | adj-139.5.3 |
| T030 | Narrow `transition: all` in chat.css | frontend/src/styles/chat.css | adj-139.5.4 |

### Phase 6 — Track F: Verification Harness

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T031 | Perf budgets doc | frontend/perf-budgets.md | adj-139.6.1 |
| T032 | Puppeteer leak regression test | frontend/tests/perf/leak-overview.test.ts | adj-139.6.2 |
| T033 | Keystroke latency benchmark | frontend/tests/perf/keystroke-latency.test.ts | adj-139.6.3 |
| T034 | README + CLAUDE.md perf-testing docs | README.md + CLAUDE.md | adj-139.6.4 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Comm Layer (Track A) | 6 | 0 | adj-139.1 |
| 2: Chat Render (Track B) | 6 | 0 (MVP) | adj-139.2 |
| 3: Memory Leaks (Track C) | 7 | 0 | adj-139.3 |
| 4: Virtualization (Track D) | 7 | 1 | adj-139.4 |
| 5: CSS (Track E) | 4 | 2 | adj-139.5 |
| 6: Verification (Track F) | 4 | 1 | adj-139.6 |
| **Total** | **34** | | |

## Dependency Graph

```
adj-139 (root)
   │
   ├── adj-139.1 (Track A: Comm Layer) ───────┐
   │       │                                    │
   │       └─→ adj-139.2 (Track B: Chat) ──────┤
   │                  │                          │
   ├── adj-139.3 (Track C: Memory)              │
   │           │                                 │
   │           ├─→ adj-139.4 (Track D: Lists) ──┤
   │           │                                 │
   ├── adj-139.5 (Track E: CSS)  ───────────────┤
   │                                             │
   └── adj-139.6 (Track F: Verification) ◄──────┘
```

## Improvements

Improvements (Level 4: adj-139.N.M.P) are NOT pre-planned here. They are created during implementation when bugs, refactors, or extra tests are discovered.
