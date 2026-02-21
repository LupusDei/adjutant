# Agent Chat UI - Beads

**Feature**: 009-agent-chat-ui
**Generated**: 2026-02-21
**Source**: specs/009-agent-chat-ui/tasks.md
**Depends On**: adj-010 (Agent MCP Bridge)

## Root Epic

- **ID**: adj-011
- **Title**: Agent Chat UI — Persistent Per-Agent Messaging on Web & iOS
- **Type**: epic
- **Priority**: 1
- **Description**: Evolve CommandChat (web) and ChatView (iOS) to use SQLite-backed messages from adj-010 message store. iMessage-style per-agent conversations with real-time delivery, unread badges, pagination, and search.

## Epics

### Phase 1 — Shared Types & API Client
- **ID**: adj-011.1
- **Type**: epic
- **Priority**: 1
- **Description**: PersistentMessage types and /api/messages client methods for web and iOS.
- **Tasks**: 6

### Phase 2 — US1: Web Chat Upgrade
- **ID**: adj-011.2
- **Type**: epic
- **Priority**: 1
- **MVP**: true
- **Description**: Modify CommandChat to use useChatMessages hook with SQLite-backed agent-scoped messages.
- **Tasks**: 7

### Phase 3 — US2: iOS Chat Upgrade
- **ID**: adj-011.3
- **Type**: epic
- **Priority**: 1
- **Description**: Modify ChatView/ChatViewModel to use SQLite-backed agent-scoped messages with APNS deep linking.
- **Tasks**: 7

### Phase 4 — US3: Agent Selector Upgrade
- **ID**: adj-011.4
- **Type**: epic
- **Priority**: 2
- **Description**: Unread message count badges per agent on both platforms.
- **Tasks**: 6

### Phase 5 — US4: History & Search
- **ID**: adj-011.5
- **Type**: epic
- **Priority**: 3
- **Description**: Cursor-based pagination and full-text search on both platforms.
- **Tasks**: 5

### Phase 6 — Polish: Cross-Cutting
- **ID**: adj-011.6
- **Type**: epic
- **Priority**: 3
- **Depends**: US1, US2
- **Description**: Deduplication, empty states, system message styling, legacy removal.
- **Tasks**: 5

## Tasks

### Phase 1 — Shared Types & API Client

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Add PersistentMessage and UnreadCount types | frontend/src/types/index.ts | adj-011.1.1 |
| T002 | Add messages API client methods | frontend/src/services/api.ts | adj-011.1.2 |
| T003 | Create PersistentMessage model (iOS) | ios/AdjutantKit/.../Models/PersistentMessage.swift | adj-011.1.3 |
| T004 | Create APIClient+Messages extension (iOS) | ios/AdjutantKit/.../Networking/APIClient+Messages.swift | adj-011.1.4 |
| T005 | Write web messages API client tests | frontend/tests/unit/api-messages.test.ts | adj-011.1.5 |
| T006 | Write iOS APIClient+Messages tests | ios/AdjutantTests/Networking/APIClientMessagesTests.swift | adj-011.1.6 |

### Phase 2 — US1: Web Chat Upgrade

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T007 | Create useChatMessages hook | frontend/src/hooks/useChatMessages.ts | adj-011.2.1 |
| T008 | Modify CommandChat to use useChatMessages | frontend/src/components/chat/CommandChat.tsx | adj-011.2.2 |
| T009 | Add agent-scoped message filtering | frontend/src/hooks/useChatMessages.ts | adj-011.2.3 |
| T010 | Add WebSocket chat_message to CommunicationContext | frontend/src/contexts/CommunicationContext.tsx | adj-011.2.4 |
| T011 | Preserve optimistic UI with delivery confirmation | frontend/src/components/chat/CommandChat.tsx | adj-011.2.5 |
| T012 | Preserve typing indicators and streaming | frontend/src/components/chat/CommandChat.tsx | adj-011.2.6 |
| T013 | Write useChatMessages tests | frontend/tests/unit/useChatMessages.test.ts | adj-011.2.7 |

### Phase 3 — US2: iOS Chat Upgrade

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T014 | Modify ChatViewModel for getMessages | ios/Adjutant/.../ChatViewModel.swift | adj-011.3.1 |
| T015 | Add agent-scoped filtering in ChatViewModel | ios/Adjutant/.../ChatViewModel.swift | adj-011.3.2 |
| T016 | Handle chat_message events in ChatWebSocketService | ios/Adjutant/.../ChatWebSocketService.swift | adj-011.3.3 |
| T017 | Wire APNS deep link to correct agent chat | ios/Adjutant/.../ChatView.swift | adj-011.3.4 |
| T018 | Preserve voice and typing indicators | ios/Adjutant/.../ChatViewModel.swift | adj-011.3.5 |
| T019 | Preserve streaming in ChatBubble | ios/Adjutant/.../ChatBubble.swift | adj-011.3.6 |
| T020 | Write ChatViewModel message tests | ios/AdjutantTests/.../ChatViewModelTests.swift | adj-011.3.7 |

### Phase 4 — US3: Agent Selector Upgrade

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T021 | Create useUnreadCounts hook | frontend/src/hooks/useUnreadCounts.ts | adj-011.4.1 |
| T022 | Add unread badges to web recipient selector | frontend/src/components/chat/CommandChat.tsx | adj-011.4.2 |
| T023 | Add unread count to iOS agent picker | ios/Adjutant/.../ChatView.swift | adj-011.4.3 |
| T024 | Mark messages read on conversation open | both platforms | adj-011.4.4 |
| T025 | Real-time badge updates via WebSocket | both platforms | adj-011.4.5 |
| T026 | Write useUnreadCounts tests | frontend/tests/unit/useUnreadCounts.test.ts | adj-011.4.6 |

### Phase 5 — US4: History & Search

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T027 | Add infinite scroll pagination to web chat | frontend/src/components/chat/CommandChat.tsx | adj-011.5.1 |
| T028 | Add pagination to iOS chat | ios/Adjutant/.../ChatViewModel.swift | adj-011.5.2 |
| T029 | Add search bar to web chat | frontend/src/components/chat/CommandChat.tsx | adj-011.5.3 |
| T030 | Add search bar to iOS chat | ios/Adjutant/.../ChatView.swift | adj-011.5.4 |
| T031 | Wire search to /api/messages/search | both platforms | adj-011.5.5 |

### Phase 6 — Polish

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T032 | Add web message deduplication | frontend/src/hooks/useChatMessages.ts | adj-011.6.1 |
| T033 | Add iOS message deduplication | ios/Adjutant/.../ChatViewModel.swift | adj-011.6.2 |
| T034 | Add empty state UI for no messages | both platforms | adj-011.6.3 |
| T035 | Add system/announcement message styling | both platforms | adj-011.6.4 |
| T036 | Remove legacy /api/mail fetch paths | both platforms | adj-011.6.5 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Types & API | 6 | 1 | adj-011.1 |
| 2: Web Chat (MVP) | 7 | 1 | adj-011.2 |
| 3: iOS Chat | 7 | 1 | adj-011.3 |
| 4: Unread Badges | 6 | 2 | adj-011.4 |
| 5: History/Search | 5 | 3 | adj-011.5 |
| 6: Polish | 5 | 3 | adj-011.6 |
| **Total** | **36** | | |

## Dependency Graph

```
[adj-010.3 complete] ──► Phase 1: Types & API (adj-011.1)
                              |
              +───────────────+───────────────+
              |                               |
    Phase 2: Web (adj-011.2)    Phase 3: iOS (adj-011.3)    [PARALLEL]
              |                               |
              +───────────────+───────────────+
                              |
                    Phase 4: Unread (adj-011.4)
                              |
                    Phase 5: Search (adj-011.5)
                              |
                    Phase 6: Polish (adj-011.6)
```

## MVP Scope

- Phase 1: 6 tasks (types + API client)
- Phase 2: 7 tasks (web chat)
- **Total MVP**: 13 tasks (web only)
- **Full P1**: 20 tasks (web + iOS)

## Improvements

Improvements (Level 4: adj-011.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
