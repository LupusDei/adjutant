# Feature Specification: iOS Message System Investigation & QA

**Feature Branch**: `010-ios-message-investigation`
**Created**: 2026-02-21
**Status**: Draft

## Problem Statement

Messages don't load correctly on the iOS native app. Despite a recent fix (adj-nqu — iOS chat history lost on background/kill), four distinct failure modes persist:

1. **Blank chat on open** — Chat loads but shows no messages initially
2. **Messages lost after backgrounding** — Messages visible, then disappear when app resumes from background
3. **Pagination broken** — Scrolling up to load older messages fails, shows gaps or duplicates
4. **Intermittent/unreliable** — Sometimes works, sometimes doesn't — timing or network dependent

This epic is a coordinated investigation + review, not a code-first implementation. The goal is to **diagnose with evidence**, **review with rigor**, and **catalog with precision** before any fixes are written.

## User Scenarios & Testing

### User Story 1 — Root Cause Investigation (Priority: P0)

A developer needs to identify exactly why each of the four iOS message loading failures occurs, with evidence-backed diagnosis tracing the bug through the full stack: iOS native code → HTTP/WS transport → backend store → response → rendering.

**Why this priority**: Without root causes, every fix is a guess. This blocks all other work.

**Independent Test**: Each symptom has a reproduction scenario with specific steps and expected vs actual behavior documented.

**Acceptance Scenarios**:

1. **Given** the iOS app opens to chat for the first time, **When** the chat view appears, **Then** the investigator documents exactly what API calls fire (or don't), what the cache returns, what the ViewModel publishes, and why the UI renders blank.
2. **Given** the iOS app has an active chat with 10+ messages, **When** the user backgrounds the app for 60 seconds and returns, **Then** the investigator documents the full lifecycle: `onDisappear` → background → foreground → `onAppear`, what state is preserved/lost, what API calls fire on resume, and what the user sees.
3. **Given** a chat has 100+ messages and the user scrolls to the top, **When** `loadMoreHistory()` fires, **Then** the investigator documents the cursor value, the API request, the response, and whether deduplication drops or duplicates messages.
4. **Given** spotty network conditions (WiFi → cellular transition, brief disconnects), **When** the user sends and receives messages, **Then** the investigator documents WebSocket reconnection behavior, sequence gap recovery, polling fallback activation, and message delivery reliability.

---

### User Story 2 — Staff-Level Code Review (Priority: P1)

A staff engineer reviews all message-related code across both the iOS native app and the backend server, looking for: race conditions, state synchronization bugs, iOS-specific edge cases, error handling gaps, architectural anti-patterns, and correctness issues.

**Why this priority**: Code review catches systemic issues that symptom-chasing misses. Runs in parallel with investigation.

**Independent Test**: Review document covers every file in the message pipeline with findings rated by severity (Critical / High / Medium / Low) and each finding includes the file, line range, issue description, and suggested fix.

**Acceptance Scenarios**:

1. **Given** the full iOS message stack (ChatViewModel, ChatWebSocketService, WebSocketClient, ResponseCache, APIClient+Messages), **When** the reviewer examines each file, **Then** a findings document is produced with at minimum: thread safety analysis, state machine correctness, error propagation paths, and resource lifecycle management.
2. **Given** the backend message stack (ws-server.ts, message-store.ts, messages.ts route), **When** the reviewer examines each file, **Then** findings document covers: broadcast correctness, pagination edge cases, replay buffer integrity, and concurrent client handling.
3. **Given** the cross-cutting concerns (auth handshake, sequence numbering, cursor pagination, optimistic UI), **When** the reviewer examines the protocol between client and server, **Then** contract mismatches, implicit assumptions, and undocumented invariants are cataloged.

---

### User Story 3 — Product UX Audit (Priority: P1)

A product-minded QA engineer evaluates the end-to-end user experience of messaging on iOS, focusing on what the user **sees, feels, and expects** at every state transition — not just whether the code works.

**Why this priority**: A technically correct system that confuses users is still broken. Runs in parallel with code review.

**Independent Test**: UX audit document covers every user-facing state with severity ratings and includes specific improvement recommendations tied to user impact.

**Acceptance Scenarios**:

1. **Given** the user opens the chat tab, **When** messages are loading, **Then** the auditor documents: what loading state is shown (spinner? skeleton? blank?), how long it takes, whether stale cached data appears first, and whether the transition from loading→loaded is jarring.
2. **Given** the WebSocket disconnects (common on iOS during backgrounding, network transitions, or memory pressure), **When** the user is unaware of the disconnection, **Then** the auditor documents: is there any visual indicator? Do sent messages silently fail? Does the user discover data loss retroactively?
3. **Given** the user switches between agents in the recipient selector, **When** a new agent is selected, **Then** the auditor documents: is there a loading flash? Is the previous agent's scroll position preserved? Are unread counts updated immediately? Is the transition smooth or jarring?
4. **Given** a long conversation history (100+ messages), **When** the user scrolls up to load more, **Then** the auditor documents: is scroll position preserved after load? Is there a loading indicator? Does the content jump? Is the pagination mechanism discoverable?

---

### User Story 4 — Comprehensive Test Suite (Priority: P1)

A test engineer writes comprehensive automated tests covering the iOS-specific failure scenarios, backend message lifecycle, and cross-layer integration points identified by the investigation and reviews.

**Why this priority**: Tests lock in findings and prevent regressions. Depends on investigation completing first.

**Independent Test**: Test suite runs green, covers all 4 symptom categories, and includes both happy-path and failure-mode tests.

**Acceptance Scenarios**:

1. **Given** the investigation has identified root causes, **When** tests are written, **Then** each root cause has at least one regression test that would have caught the original bug.
2. **Given** the backend message store, **When** pagination tests run, **Then** edge cases are covered: empty results, single message, cursor at boundary, same-second messages, deleted cursor ID.
3. **Given** the WebSocket server, **When** reconnection tests run, **Then** scenarios are covered: auth timeout, sequence gap recovery, replay buffer overflow, concurrent client sync.
4. **Given** the frontend message hooks, **When** lifecycle tests run, **Then** scenarios are covered: optimistic send + failure, deduplication of WS + REST messages, cache-to-live transition.

---

### Edge Cases

- What happens when the server returns an empty message list but `hasMore: true`?
- What happens when two clients send messages at the exact same second (timestamp collision)?
- What happens when the replay buffer overflows (>1000 messages) during a long disconnect?
- What happens when the iOS app is killed via force-quit (no `onDisappear` fires)?
- What happens when the API key expires or is rotated while the app is backgrounded?
- What happens when the backend restarts while an iOS client has an active WebSocket?

## Requirements

### Functional Requirements

- **FR-001**: Investigation MUST produce reproduction steps for each of the 4 symptoms
- **FR-002**: Code review MUST cover every file in the message pipeline (iOS + backend)
- **FR-003**: UX audit MUST cover every user-visible state transition in the chat flow
- **FR-004**: Test suite MUST include regression tests for each identified root cause
- **FR-005**: All findings MUST be severity-rated (Critical / High / Medium / Low)
- **FR-006**: Fix recommendations MUST be prioritized and actionable, not just observations

### Non-Functional Requirements

- **NFR-001**: Investigation evidence must be traceable (file paths, line numbers, API logs)
- **NFR-002**: Review documents must be structured for async team consumption (not just notes)
- **NFR-003**: Test suite must integrate with existing Vitest infrastructure

## Success Criteria

- **SC-001**: All 4 symptom root causes identified with evidence
- **SC-002**: Code review covers 100% of message pipeline files with ≥1 finding per file or explicit "clean" verdict
- **SC-003**: UX audit catalogs every user-facing state with severity rating
- **SC-004**: Test suite adds ≥15 new tests covering identified failure modes
- **SC-005**: Prioritized fix plan produced, ready for implementation epic
