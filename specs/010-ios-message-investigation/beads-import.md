# iOS Message System Investigation & QA - Beads

**Feature**: 010-ios-message-investigation
**Generated**: 2026-02-21
**Source**: specs/010-ios-message-investigation/tasks.md

## Root Epic

- **ID**: adj-012
- **Title**: iOS Message System Investigation & QA
- **Type**: epic
- **Priority**: 0
- **Description**: Coordinated investigation into four iOS message loading failures (blank on open, lost after background, broken pagination, intermittent) through parallel workstreams: root cause investigation, staff code review, product UX audit, and comprehensive test coverage. Produces prioritized fix plan.

## Epics

### Phase 1 — Setup: Investigation Baseline
- **ID**: adj-012.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 2

### Phase 2 — US1: Root Cause Investigation (MVP)
- **ID**: adj-012.2
- **Type**: epic
- **Priority**: 0
- **MVP**: true
- **Tasks**: 5

### Phase 3 — US2: Staff Code Review
- **ID**: adj-012.3
- **Type**: epic
- **Priority**: 1
- **Tasks**: 6

### Phase 4 — US3: Product UX Audit
- **ID**: adj-012.4
- **Type**: epic
- **Priority**: 1
- **Tasks**: 5

### Phase 5 — US4: Test Suite
- **ID**: adj-012.5
- **Type**: epic
- **Priority**: 1
- **Depends**: adj-012.2
- **Tasks**: 4

### Phase 6 — Synthesis: Fix Plan
- **ID**: adj-012.6
- **Type**: epic
- **Priority**: 1
- **Depends**: adj-012.2, adj-012.3, adj-012.4, adj-012.5
- **Tasks**: 2

## Tasks

### Phase 1 — Setup

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Catalog message pipeline files with review checklists | specs/010-ios-message-investigation/file-catalog.md | adj-012.1.1 |
| T002 | Document current iOS app behavior baseline | specs/010-ios-message-investigation/behavior-baseline.md | adj-012.1.2 |

### Phase 2 — US1: Root Cause Investigation

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T003 | Investigate: Blank chat on open | ios/.../ChatViewModel.swift | adj-012.2.1 |
| T004 | Investigate: Messages lost after backgrounding | ios/.../ChatViewModel.swift, AdjutantApp.swift | adj-012.2.2 |
| T005 | Investigate: Pagination broken | ios/.../ChatViewModel.swift, APIClient+Messages.swift | adj-012.2.3 |
| T006 | Investigate: Intermittent/unreliable loading | ios/.../WebSocketClient.swift, ChatWebSocketService.swift | adj-012.2.4 |
| T007 | Write investigation findings document | specs/010-ios-message-investigation/investigation-findings.md | adj-012.2.5 |

### Phase 3 — US2: Staff Code Review

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T008 | Review: iOS ChatViewModel lifecycle | ios/.../ChatViewModel.swift | adj-012.3.1 |
| T009 | Review: iOS WebSocket stack | ios/.../ChatWebSocketService.swift, WebSocketClient.swift | adj-012.3.2 |
| T010 | Review: iOS cache + persistence | ios/.../ResponseCache.swift, APIClient+Messages.swift | adj-012.3.3 |
| T011 | Review: Backend message pipeline | backend/src/services/ws-server.ts, message-store.ts, routes/messages.ts | adj-012.3.4 |
| T012 | Review: Cross-cutting protocol contracts | auth, seq, cursor, optimistic UI | adj-012.3.5 |
| T013 | Write staff review findings document | specs/010-ios-message-investigation/staff-review-findings.md | adj-012.3.6 |

### Phase 4 — US3: Product UX Audit

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T014 | Audit: Loading states and transitions | ios/.../ChatView.swift, ChatViewModel.swift | adj-012.4.1 |
| T015 | Audit: Reconnection and failure UX | ios/.../ChatView.swift, ChatWebSocketService.swift | adj-012.4.2 |
| T016 | Audit: Agent switching and scroll preservation | ios/.../ChatView.swift | adj-012.4.3 |
| T017 | Audit: Notification-to-chat flow | ios/.../AppDelegate.swift, NotificationService.swift | adj-012.4.4 |
| T018 | Write UX audit findings document | specs/010-ios-message-investigation/ux-audit-findings.md | adj-012.4.5 |

### Phase 5 — US4: Test Suite

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T019 | Write message-store pagination edge case tests | backend/tests/unit/message-store.test.ts | adj-012.5.1 |
| T020 | Write WebSocket reconnection and replay tests | backend/tests/unit/ws-server.test.ts | adj-012.5.2 |
| T021 | Write useChatMessages lifecycle tests | frontend/tests/unit/hooks/useChatMessages.test.ts | adj-012.5.3 |
| T022 | Write CommunicationContext fallback tests | frontend/tests/unit/contexts/CommunicationContext.test.tsx | adj-012.5.4 |

### Phase 6 — Synthesis

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T023 | Synthesize findings into prioritized fix plan | specs/010-ios-message-investigation/fix-plan.md | adj-012.6.1 |
| T024 | Create implementation epic beads for fixes | .beads/ | adj-012.6.2 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Setup | 2 | 1 | adj-012.1 |
| 2: Investigation (MVP) | 5 | 0 | adj-012.2 |
| 3: Staff Code Review | 6 | 1 | adj-012.3 |
| 4: Product UX Audit | 5 | 1 | adj-012.4 |
| 5: Test Suite | 4 | 1 | adj-012.5 |
| 6: Synthesis | 2 | 1 | adj-012.6 |
| **Total** | **24** | | |

## Dependency Graph

```
Phase 1: Setup (adj-012.1)
    |
    v
Phase 2: Investigation (adj-012.2, MVP)  Phase 3: Code Review (adj-012.3)  Phase 4: UX Audit (adj-012.4)  [parallel]
    |                                          |                                  |
    v                                          |                                  |
Phase 5: Test Suite (adj-012.5)                |                                  |
    |                                          |                                  |
    +------------------------------------------+----------------------------------+
    |
    v
Phase 6: Synthesis (adj-012.6)
```

## Improvements

Improvements (Level 4: adj-012.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered. See
SKILL.md "Improvements (Post-Planning)" section for the workflow.
