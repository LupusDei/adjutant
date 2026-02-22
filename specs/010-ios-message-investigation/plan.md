# Implementation Plan: iOS Message System Investigation & QA

**Branch**: `010-ios-message-investigation` | **Date**: 2026-02-21
**Epic**: `adj-012` | **Priority**: P0

## Summary

Coordinated investigation into four iOS message loading failures (blank on open, lost after background, broken pagination, intermittent) through parallel workstreams: root cause investigation, staff-level code review, product UX audit, and comprehensive test coverage. Each workstream produces a structured findings document; a final synthesis produces a prioritized fix plan.

## Bead Map

- `adj-012` - Root: iOS Message System Investigation & QA
  - `adj-012.1` - Phase 1: Investigation Setup
    - `adj-012.1.1` - Catalog message pipeline files and create review checklists
    - `adj-012.1.2` - Document current iOS app behavior baseline
  - `adj-012.2` - Phase 2: Root Cause Investigation
    - `adj-012.2.1` - Investigate: Blank chat on open
    - `adj-012.2.2` - Investigate: Messages lost after backgrounding
    - `adj-012.2.3` - Investigate: Pagination broken
    - `adj-012.2.4` - Investigate: Intermittent/unreliable loading
    - `adj-012.2.5` - Write investigation findings document
  - `adj-012.3` - Phase 3: Staff Code Review
    - `adj-012.3.1` - Review iOS ChatViewModel + lifecycle management
    - `adj-012.3.2` - Review iOS WebSocket stack (ChatWebSocketService + WebSocketClient)
    - `adj-012.3.3` - Review iOS cache + persistence (ResponseCache + APIClient+Messages)
    - `adj-012.3.4` - Review backend message pipeline (ws-server + message-store + routes)
    - `adj-012.3.5` - Review cross-cutting protocol contracts (auth, seq, cursor, optimistic)
    - `adj-012.3.6` - Write staff review findings document
  - `adj-012.4` - Phase 4: Product UX Audit
    - `adj-012.4.1` - Audit: Loading states and transitions
    - `adj-012.4.2` - Audit: Reconnection and failure UX
    - `adj-012.4.3` - Audit: Agent switching and scroll preservation
    - `adj-012.4.4` - Audit: Notification-to-chat flow
    - `adj-012.4.5` - Write UX audit findings document
  - `adj-012.5` - Phase 5: Test Suite
    - `adj-012.5.1` - Write backend message-store pagination edge case tests
    - `adj-012.5.2` - Write backend WebSocket reconnection and replay tests
    - `adj-012.5.3` - Write frontend useChatMessages lifecycle tests
    - `adj-012.5.4` - Write frontend CommunicationContext fallback chain tests
  - `adj-012.6` - Phase 6: Synthesis & Fix Plan
    - `adj-012.6.1` - Synthesize findings into prioritized fix plan
    - `adj-012.6.2` - Create implementation epic beads for fixes

## Technical Context

**Stack**: Swift/SwiftUI (iOS native), TypeScript/Node.js (backend), React (web frontend)
**Storage**: SQLite (backend messages), UserDefaults (iOS cache, 50 msg limit)
**Testing**: Vitest (backend + web frontend), XCTest (iOS — if available)
**Constraints**: iOS app lifecycle (backgrounding kills WebSocket, SSE), Safari WebKit quirks, cellular network transitions

## Architecture Decision

This is an **investigation-first** epic, not a fix-first epic. The team produces findings documents before any code changes. This prevents:
- Fixing symptoms without understanding root causes
- Missing systemic issues that span multiple files
- Introducing new bugs by changing code without full context

Each workstream writes to a structured document in `specs/010-ios-message-investigation/`:
- `investigation-findings.md` — Root cause analysis with evidence
- `staff-review-findings.md` — Code review with severity-rated findings
- `ux-audit-findings.md` — Product UX evaluation with impact ratings
- `fix-plan.md` — Synthesized, prioritized remediation plan

## Files Under Review

### iOS Native (Investigation + Review Targets)

| File | Focus Area |
|------|-----------|
| `ios/Adjutant/Sources/Features/Chat/ViewModels/ChatViewModel.swift` | Message fetch, lifecycle, polling, state management |
| `ios/Adjutant/Sources/Features/Chat/Services/ChatWebSocketService.swift` | WS message translation, event dispatch, streaming |
| `ios/AdjutantKit/Sources/AdjutantKit/Networking/WebSocketClient.swift` | Low-level WS, auth handshake, sequence tracking, reconnection |
| `ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Messages.swift` | HTTP message endpoints, pagination cursors |
| `ios/Adjutant/Core/Cache/ResponseCache.swift` | In-memory + UserDefaults persistence |
| `ios/AdjutantKit/Sources/AdjutantKit/Models/PersistentMessage.swift` | Message data model, codable, date parsing |
| `ios/Adjutant/Sources/Features/Chat/Views/ChatView.swift` | UI rendering, scroll management, pull-to-refresh |
| `ios/Adjutant/Sources/Features/Chat/Views/ChatBubble.swift` | Message rendering |
| `ios/Adjutant/Core/Services/BackgroundTaskService.swift` | Background refresh, scene phase handling |
| `ios/Adjutant/App/AppDelegate.swift` | APNS registration, remote notification handling |
| `ios/Adjutant/Core/Services/NotificationService.swift` | Local notification scheduling, tap handling |
| `ios/Adjutant/App/AdjutantApp.swift` | Scene phase management, SSE lifecycle |

### Backend (Review Targets)

| File | Focus Area |
|------|-----------|
| `backend/src/services/ws-server.ts` | WebSocket server, auth, seq numbering, replay buffer, broadcast |
| `backend/src/services/message-store.ts` | SQLite persistence, cursor pagination, FTS5, unread counts |
| `backend/src/routes/messages.ts` | REST endpoints for messages |
| `backend/src/services/mcp-tools/messaging.ts` | MCP tools for agent messaging |

### Frontend (Review Targets)

| File | Focus Area |
|------|-----------|
| `frontend/src/hooks/useChatMessages.ts` | Message state, pagination, optimistic UI, dedup |
| `frontend/src/hooks/useChatWebSocket.ts` | Direct WS management |
| `frontend/src/contexts/CommunicationContext.tsx` | WS/SSE/polling fallback chain |
| `frontend/src/components/chat/CommandChat.tsx` | Chat UI, send flow |

## Phase 1: Investigation Setup

**Purpose**: Establish baseline understanding and create structured checklists before deep dives.

- Catalog every file in the message pipeline with its role
- Create review checklists per file (what to look for)
- Document current iOS app behavior as a baseline (what works, what doesn't, under what conditions)

## Phase 2: Root Cause Investigation (US1, MVP)

**Purpose**: Diagnose each of the 4 symptoms with evidence. Each investigation follows the same template:

```
## Symptom: [Name]
### Reproduction Steps
### Expected Behavior
### Actual Behavior
### Stack Trace (code path)
### Root Cause Analysis
### Evidence (file:line, API logs, state dumps)
### Severity
### Recommended Fix
```

Four parallel investigations, one per symptom:
1. Blank chat on open — trace `onAppear` → `loadRecipients` → `refresh` → API → cache → render
2. Lost after background — trace `onDisappear` → background → foreground → `observeForegroundTransitions` → state recovery
3. Pagination broken — trace `loadMoreHistory` → cursor construction → API request → response merge → dedup
4. Intermittent — trace WebSocket lifecycle, reconnection attempts, polling fallback, network transition handling

## Phase 3: Staff Code Review (US2)

**Purpose**: Systematic review of every file in the message pipeline. Each review follows:

```
## File: [path]
### Purpose
### Findings
- [CRITICAL/HIGH/MEDIUM/LOW] [Title]: [Description] (lines X-Y)
### Thread Safety Analysis
### Error Handling Assessment
### iOS-Specific Concerns
```

Reviews can run in parallel across different files. Grouped by layer:
1. iOS ViewModel + lifecycle (ChatViewModel)
2. iOS WebSocket stack (ChatWebSocketService + WebSocketClient)
3. iOS cache + persistence (ResponseCache + APIClient)
4. Backend message pipeline (ws-server + message-store + routes)
5. Cross-cutting protocol contracts (auth handshake, seq numbering, cursor pagination, optimistic UI)

## Phase 4: Product UX Audit (US3)

**Purpose**: Evaluate what the user sees and feels at every state transition. Each audit follows:

```
## State Transition: [from → to]
### What User Sees
### What User Expects
### Gap Analysis
### Impact (Critical/High/Medium/Low)
### Recommendation
```

Four audit areas, can run in parallel:
1. Loading states — initial load, refresh, pagination load, agent switch load
2. Reconnection and failure — WS drop, SSE fallback, polling fallback, send failure
3. Agent switching and scroll — recipient change, scroll preservation, unread badge sync
4. Notification-to-chat — APNS tap, cold start navigation, warm start navigation

## Phase 5: Test Suite (US4)

**Purpose**: Write automated tests that would have caught these bugs and prevent regressions.

Tests go in existing test directories:
- `backend/tests/unit/message-store.test.ts` — pagination edge cases
- `backend/tests/unit/ws-server.test.ts` — reconnection, replay, concurrent clients
- `frontend/tests/unit/hooks/useChatMessages.test.ts` — lifecycle, dedup, optimistic UI
- `frontend/tests/unit/contexts/CommunicationContext.test.tsx` — fallback chain

## Phase 6: Synthesis & Fix Plan

**Purpose**: Merge all findings into a single prioritized fix plan, then create implementation beads.

The fix plan rates each issue by:
- **Severity**: How bad is it? (P0–P4)
- **Frequency**: How often does it happen? (Always / Often / Sometimes / Rarely)
- **Fix Complexity**: How hard to fix? (Trivial / Small / Medium / Large)
- **User Impact**: What does the user experience? (Data loss / Confusion / Annoyance / Cosmetic)

## Parallel Execution

```
Phase 1: Setup (sequential, blocks everything)
    |
    v
Phase 2: Investigation ──┐
Phase 3: Code Review ─────┼── All three run in parallel
Phase 4: UX Audit ────────┘
    |
    v (all three complete)
Phase 5: Test Suite (depends on Phase 2 findings)
    |
    v
Phase 6: Synthesis (depends on all phases)
```

Phases 2, 3, and 4 are assigned to different team agents and run concurrently. Phase 5 can begin partially once Phase 2 produces findings. Phase 6 waits for everything.

## Team Coordination Model

Each agent writes findings to a shared document in `specs/010-ios-message-investigation/`. Documents are the coordination mechanism — no real-time cross-talk required.

| Agent Role | Assigned Phases | Output Document |
|------------|-----------------|-----------------|
| Investigator | Phase 2 | `investigation-findings.md` |
| Staff Reviewer | Phase 3 | `staff-review-findings.md` |
| UX Auditor | Phase 4 | `ux-audit-findings.md` |
| Test Engineer | Phase 5 | Tests in `backend/tests/` and `frontend/tests/` |
| Coordinator | Phase 1, Phase 6 | `fix-plan.md` |

## Verification Steps

- [ ] Each symptom has documented reproduction steps with evidence
- [ ] Every message pipeline file has a code review entry (finding or "clean" verdict)
- [ ] Every user-visible state transition has a UX audit entry
- [ ] Test suite runs green and covers all 4 symptom categories
- [ ] Fix plan has ≥1 actionable item per root cause, severity-rated and prioritized
