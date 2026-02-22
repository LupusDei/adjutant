# Tasks: iOS Message System Investigation & QA

**Input**: Design documents from `/specs/010-ios-message-investigation/`
**Epic**: `adj-012`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-012.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Investigation Setup

**Purpose**: Establish baseline and create structured checklists for all reviewers.

- [ ] T001 [US1] Catalog all message pipeline files (iOS + backend + frontend) with role annotations and create per-file review checklists in `specs/010-ios-message-investigation/file-catalog.md`
- [ ] T002 [US1] Document current iOS app behavior baseline: what works, what fails, under what conditions, with screenshots/logs where possible in `specs/010-ios-message-investigation/behavior-baseline.md`

**Checkpoint**: Review checklists and behavior baseline ready — deep dives can begin

---

## Phase 2: Root Cause Investigation (Priority: P0, MVP)

**Goal**: Diagnose each of the 4 symptoms with evidence-backed root cause analysis
**Independent Test**: Each symptom has reproduction steps, stack trace, and root cause documented

- [ ] T003 [US1] Investigate blank chat on open: trace `onAppear` → `loadRecipients` → `refresh` → API → cache → render path in `ios/Adjutant/Sources/Features/Chat/ViewModels/ChatViewModel.swift`
- [ ] T004 [P] [US1] Investigate messages lost after backgrounding: trace `onDisappear` → background → foreground → `observeForegroundTransitions` lifecycle in `ios/Adjutant/Sources/Features/Chat/ViewModels/ChatViewModel.swift` and `ios/Adjutant/App/AdjutantApp.swift`
- [ ] T005 [P] [US1] Investigate pagination broken: trace `loadMoreHistory` → cursor construction → API request → response merge → dedup in `ios/Adjutant/Sources/Features/Chat/ViewModels/ChatViewModel.swift` and `ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Messages.swift`
- [ ] T006 [P] [US1] Investigate intermittent/unreliable: trace WebSocket lifecycle, reconnection, polling fallback, network transitions in `ios/AdjutantKit/Sources/AdjutantKit/Networking/WebSocketClient.swift` and `ios/Adjutant/Sources/Features/Chat/Services/ChatWebSocketService.swift`
- [ ] T007 [US1] Write investigation findings document consolidating all 4 root cause analyses to `specs/010-ios-message-investigation/investigation-findings.md`

**Checkpoint**: All 4 root causes identified with evidence — code review and tests can incorporate findings

---

## Phase 3: Staff Code Review (Priority: P1)

**Goal**: Staff-engineer-level review of every message pipeline file for correctness, race conditions, and iOS edge cases
**Independent Test**: Review document covers every file with severity-rated findings

- [ ] T008 [P] [US2] Review iOS ChatViewModel: lifecycle management, state machine correctness, thread safety, error propagation in `ios/Adjutant/Sources/Features/Chat/ViewModels/ChatViewModel.swift`
- [ ] T009 [P] [US2] Review iOS WebSocket stack: ChatWebSocketService event dispatch + WebSocketClient auth/reconnect/sequence tracking in `ios/Adjutant/Sources/Features/Chat/Services/ChatWebSocketService.swift` and `ios/AdjutantKit/Sources/AdjutantKit/Networking/WebSocketClient.swift`
- [ ] T010 [P] [US2] Review iOS cache + persistence: ResponseCache dual-layer strategy, UserDefaults limits, APIClient+Messages cursor handling in `ios/Adjutant/Core/Cache/ResponseCache.swift` and `ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Messages.swift`
- [ ] T011 [P] [US2] Review backend message pipeline: ws-server.ts broadcast/replay/rate-limiting, message-store.ts pagination/FTS5, messages.ts REST endpoints in `backend/src/services/ws-server.ts`, `backend/src/services/message-store.ts`, `backend/src/routes/messages.ts`
- [ ] T012 [US2] Review cross-cutting protocol contracts: auth handshake assumptions, sequence numbering invariants, cursor pagination contract, optimistic UI protocol between iOS client and backend
- [ ] T013 [US2] Write staff review findings document consolidating all reviews to `specs/010-ios-message-investigation/staff-review-findings.md`

**Checkpoint**: Staff review complete — systemic issues identified across the full stack

---

## Phase 4: Product UX Audit (Priority: P1)

**Goal**: Evaluate what the user sees and feels at every state transition in chat
**Independent Test**: Every user-visible state has an audit entry with impact rating

- [ ] T014 [P] [US3] Audit loading states and transitions: initial load, refresh, pagination load, agent switch in `ios/Adjutant/Sources/Features/Chat/Views/ChatView.swift` and `ios/Adjutant/Sources/Features/Chat/ViewModels/ChatViewModel.swift`
- [ ] T015 [P] [US3] Audit reconnection and failure UX: WS drop indicator, SSE fallback indicator, send failure feedback, offline state in `ios/Adjutant/Sources/Features/Chat/Views/ChatView.swift` and `ios/Adjutant/Sources/Features/Chat/Services/ChatWebSocketService.swift`
- [ ] T016 [P] [US3] Audit agent switching and scroll preservation: recipient change transition, scroll position, unread badge sync, conversation context switching in `ios/Adjutant/Sources/Features/Chat/Views/ChatView.swift`
- [ ] T017 [P] [US3] Audit notification-to-chat flow: APNS tap cold start, warm start navigation, deep link accuracy in `ios/Adjutant/App/AppDelegate.swift` and `ios/Adjutant/Core/Services/NotificationService.swift`
- [ ] T018 [US3] Write UX audit findings document consolidating all audits to `specs/010-ios-message-investigation/ux-audit-findings.md`

**Checkpoint**: UX audit complete — every user-facing gap cataloged with severity

---

## Phase 5: Test Suite (Priority: P1)

**Goal**: Comprehensive automated tests covering identified failure modes
**Independent Test**: Test suite runs green, covers all 4 symptom categories

- [ ] T019 [P] [US4] Write backend message-store pagination edge case tests: empty results, single message, cursor boundary, same-second timestamps, deleted cursor ID, hasMore flag accuracy in `backend/tests/unit/message-store.test.ts`
- [ ] T020 [P] [US4] Write backend WebSocket reconnection and replay tests: auth timeout, sequence gap recovery, replay buffer overflow, concurrent client sync, rate limiting in `backend/tests/unit/ws-server.test.ts`
- [ ] T021 [P] [US4] Write frontend useChatMessages lifecycle tests: optimistic send + failure, dedup of WS + REST messages, cache-to-live transition, agent switch state reset in `frontend/tests/unit/hooks/useChatMessages.test.ts`
- [ ] T022 [P] [US4] Write frontend CommunicationContext fallback chain tests: WS → SSE → polling degradation, reconnection attempts, priority persistence in `frontend/tests/unit/contexts/CommunicationContext.test.tsx`

**Checkpoint**: Test suite passing — regressions locked down

---

## Phase 6: Synthesis & Fix Plan

**Goal**: Merge all findings into a prioritized, actionable fix plan

- [ ] T023 [US1] Synthesize investigation findings, code review findings, and UX audit findings into prioritized fix plan with severity/frequency/complexity/impact ratings in `specs/010-ios-message-investigation/fix-plan.md`
- [ ] T024 [US1] Create implementation epic beads for the top-priority fixes identified in fix-plan.md

**Checkpoint**: Fix plan ready — implementation epic can begin

---

## Dependencies

- Phase 1 (Setup) → blocks Phase 2, Phase 3, Phase 4
- Phase 2 (Investigation) → blocks Phase 5 (need root causes for regression tests)
- Phase 3 (Code Review) runs parallel with Phase 2 and Phase 4
- Phase 4 (UX Audit) runs parallel with Phase 2 and Phase 3
- Phase 5 (Tests) → partially blocked by Phase 2, but backend tests (T019, T020) can start early
- Phase 6 (Synthesis) → blocked by Phase 2, Phase 3, Phase 4, Phase 5

## Parallel Opportunities

- T003, T004, T005, T006 within Phase 2 (different symptoms, independent investigation)
- T008, T009, T010, T011 within Phase 3 (different files, independent reviews)
- T014, T015, T016, T017 within Phase 4 (different UX areas, independent audits)
- T019, T020, T021, T022 within Phase 5 (different test files, independent test suites)
- Phase 2, Phase 3, Phase 4 run in parallel after Phase 1 completes
