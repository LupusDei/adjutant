# Tasks: Agent Chat UI

**Input**: Design documents from `/specs/009-agent-chat-ui/`
**Epic**: `adj-011`
**Depends On**: adj-010 (MCP backend)

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Authoring-time identifiers for this document
- **Bead IDs** (adj-011.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1-US4)

---

## Phase 1: Shared Types & API Client

**Purpose**: Types and API client methods for /api/messages on both platforms

- [ ] T001 [P] Add PersistentMessage and UnreadCount types in frontend/src/types/index.ts
- [ ] T002 [P] Add messages API client methods (list, send, markRead, search) in frontend/src/services/api.ts
- [ ] T003 [P] Create PersistentMessage model with Codable conformance in ios/AdjutantKit/Sources/AdjutantKit/Models/PersistentMessage.swift
- [ ] T004 [P] Create APIClient+Messages extension with message endpoints in ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Messages.swift
- [ ] T005 Write tests for web messages API client in frontend/tests/unit/api-messages.test.ts
- [ ] T006 Write tests for iOS APIClient+Messages in ios/AdjutantTests/Networking/APIClientMessagesTests.swift

**Checkpoint**: Both platforms can call /api/messages endpoints

---

## Phase 2: US1 — Web Chat Upgrade (Priority: P1, MVP)

**Goal**: CommandChat uses SQLite-backed messages scoped per agent
**Independent Test**: Select agent, send message, agent replies via MCP, message appears in 2s, persists across restart

- [ ] T007 [US1] Create useChatMessages hook (fetch + WebSocket chat_message subscription) in frontend/src/hooks/useChatMessages.ts
- [ ] T008 [US1] Modify CommandChat to use useChatMessages instead of mail-based fetching in frontend/src/components/chat/CommandChat.tsx
- [ ] T009 [US1] Add agent-scoped message filtering (to/from selected agent) in frontend/src/hooks/useChatMessages.ts
- [ ] T010 [US1] Add WebSocket chat_message event handling to CommunicationContext in frontend/src/contexts/CommunicationContext.tsx
- [ ] T011 [US1] Preserve optimistic UI with delivery confirmation for /api/messages in frontend/src/components/chat/CommandChat.tsx
- [ ] T012 [US1] Preserve typing indicators and streaming response rendering in frontend/src/components/chat/CommandChat.tsx
- [ ] T013 [US1] Write tests for useChatMessages hook in frontend/tests/unit/useChatMessages.test.ts

**Checkpoint**: Web chat shows persistent, agent-scoped messages from SQLite

---

## Phase 3: US2 — iOS Chat Upgrade (Priority: P1)

**Goal**: ChatView uses SQLite-backed messages scoped per agent
**Independent Test**: Select agent, send message, agent replies via MCP, message appears in 2s, APNS push when backgrounded

- [ ] T014 [US2] Modify ChatViewModel to fetch from getMessages(agentId:) instead of getMail in ios/Adjutant/Features/Chat/ViewModels/ChatViewModel.swift
- [ ] T015 [US2] Add agent-scoped message filtering in ChatViewModel in ios/Adjutant/Features/Chat/ViewModels/ChatViewModel.swift
- [ ] T016 [US2] Modify ChatWebSocketService to handle chat_message events from MCP agents in ios/Adjutant/Features/Chat/Services/ChatWebSocketService.swift
- [ ] T017 [US2] Wire APNS deep link: notification tap opens chat with correct agent in ios/Adjutant/Features/Chat/Views/ChatView.swift
- [ ] T018 [US2] Preserve voice input/playback and typing indicators in ios/Adjutant/Features/Chat/ViewModels/ChatViewModel.swift
- [ ] T019 [US2] Preserve streaming response rendering in ChatBubble in ios/Adjutant/Features/Chat/Views/ChatBubble.swift
- [ ] T020 [US2] Write tests for ChatViewModel message fetching in ios/AdjutantTests/Features/Chat/ChatViewModelTests.swift

**Checkpoint**: iOS chat shows persistent, agent-scoped messages from SQLite

---

## Phase 4: US3 — Agent Selector Upgrade (Priority: P2)

**Goal**: Unread message counts per agent on both platforms
**Independent Test**: 3 agents send messages, verify badges appear, selecting agent clears badge

- [ ] T021 [P] [US3] Create useUnreadCounts hook in frontend/src/hooks/useUnreadCounts.ts
- [ ] T022 [US3] Add unread badges to recipient selector in frontend/src/components/chat/CommandChat.tsx
- [ ] T023 [US3] Add unread count display to agent picker in ios/Adjutant/Features/Chat/Views/ChatView.swift
- [ ] T024 [US3] Mark messages as read on conversation open (PATCH /api/messages/:id/read) in both platforms
- [ ] T025 [US3] Real-time badge updates via WebSocket chat_message events on both platforms
- [ ] T026 [P] [US3] Write tests for useUnreadCounts hook in frontend/tests/unit/useUnreadCounts.test.ts

**Checkpoint**: Unread badges visible and responsive on both platforms

---

## Phase 5: US4 — History & Search (Priority: P3)

**Goal**: Paginated history and full-text search across conversations
**Independent Test**: 100+ messages, infinite scroll loads older, search returns cross-agent results

- [ ] T027 [P] [US4] Add cursor-based pagination (infinite scroll) to web chat in frontend/src/components/chat/CommandChat.tsx
- [ ] T028 [P] [US4] Add pagination ("Load earlier messages") to iOS chat in ios/Adjutant/Features/Chat/ViewModels/ChatViewModel.swift
- [ ] T029 [P] [US4] Add search bar to web chat header in frontend/src/components/chat/CommandChat.tsx
- [ ] T030 [P] [US4] Add search bar to iOS chat view in ios/Adjutant/Features/Chat/Views/ChatView.swift
- [ ] T031 [US4] Wire search to GET /api/messages/search?q= on both platforms

**Checkpoint**: Full message history browsable and searchable

---

## Phase 6: Polish & Cross-Cutting

**Purpose**: Quality, edge cases, deduplication

- [ ] T032 [P] Add message deduplication (by ID) for WebSocket + polling overlap in frontend/src/hooks/useChatMessages.ts
- [ ] T033 [P] Add message deduplication in iOS ChatViewModel in ios/Adjutant/Features/Chat/ViewModels/ChatViewModel.swift
- [ ] T034 [P] Add empty state UI for agents with no messages on both platforms
- [ ] T035 [P] Add system/announcement message styling in chat bubbles on both platforms
- [ ] T036 Remove legacy /api/mail fetch paths from CommandChat and ChatViewModel

---

## Dependencies & Execution Order

### External Dependency

- **adj-010** (Agent MCP Bridge) MUST complete Phases 1-3 before this epic starts:
  - Phase 1: Database + message-store (provides SQLite persistence)
  - Phase 2: MCP Server (provides agent connections)
  - Phase 3: Messaging tools (provides /api/messages endpoints + WebSocket events)

### Phase Dependencies

- **Phase 1** (Types & API): No internal deps — start immediately after adj-010.3 completes
- **Phase 2** (Web) + **Phase 3** (iOS): Both depend on Phase 1. Can run **fully in parallel**
- **Phase 4** (Unread): Depends on Phase 1. Benefits from Phase 2/3 but can start after Phase 1
- **Phase 5** (History/Search): Depends on Phases 2 and 3
- **Phase 6** (Polish): Depends on Phases 2 and 3

### Parallel Opportunities

- T001 + T002 + T003 + T004: All parallel (different files, different platforms)
- Phase 2 (T007-T013) + Phase 3 (T014-T020): Fully parallel (web vs iOS)
- T021 + T026, T027 + T028 + T029 + T030: Parallel within phases
- T032 + T033 + T034 + T035: Parallel within Polish

### Critical Path

```
adj-010.3 → T001 (types) → T007 (useChatMessages) → T008 (CommandChat) → T022 (unread badges) → T027 (pagination)
```
