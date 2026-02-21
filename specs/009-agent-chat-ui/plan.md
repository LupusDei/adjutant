# Implementation Plan: Agent Chat UI

**Branch**: `009-agent-chat-ui` | **Date**: 2026-02-21
**Epic**: `adj-011` | **Priority**: P1
**Depends On**: adj-010 (MCP backend must provide /api/messages, WebSocket chat_message, message-store)

## Summary

Modify existing CommandChat (web) and ChatView (iOS) to use SQLite-backed messages from the adj-010 message store. Each agent gets an iMessage-style conversation. Real-time delivery via WebSocket, with polling fallback. Preserve existing UX (optimistic UI, typing, streaming, voice).

## Bead Map

- `adj-011` - Root: Agent Chat UI (depends on adj-010.3)
  - `adj-011.1` - Phase 1: Shared Types & API Client (6 tasks)
  - `adj-011.2` - US1: Web Chat Upgrade (7 tasks, MVP)
    - `adj-011.2.1` - Create useChatMessages hook
    - `adj-011.2.2` - Modify CommandChat
    - `adj-011.2.3` - Agent-scoped filtering
    - `adj-011.2.4` - WebSocket chat_message in CommunicationContext
    - `adj-011.2.5` - Optimistic UI preservation
    - `adj-011.2.6` - Typing/streaming preservation
    - `adj-011.2.7` - Tests
  - `adj-011.3` - US2: iOS Chat Upgrade (7 tasks)
    - `adj-011.3.1` - ChatViewModel getMessages
    - `adj-011.3.2` - Agent-scoped filtering
    - `adj-011.3.3` - ChatWebSocketService chat_message
    - `adj-011.3.4` - APNS deep link
    - `adj-011.3.5` - Voice/typing preservation
    - `adj-011.3.6` - Streaming preservation
    - `adj-011.3.7` - Tests
  - `adj-011.4` - US3: Agent Selector Upgrade (6 tasks)
  - `adj-011.5` - US4: History & Search (5 tasks)
  - `adj-011.6` - Polish (5 tasks)

## Technical Context

**Web Stack**: React + TypeScript + Tailwind CSS + Vite
**iOS Stack**: SwiftUI + AdjutantKit + Combine
**Backend**: adj-010 provides /api/messages, WebSocket chat_message events, SQLite message-store
**Testing**: Vitest (web), XCTest (iOS)
**Constraints**: Must work through ngrok tunnels, maintain CRT aesthetic, preserve voice/streaming/typing features

## Architecture Decision

### Modify existing vs new components

Modify the existing CommandChat and ChatView rather than creating new views because:
- The UX is already right (SMS bubbles, optimistic UI, streaming, voice)
- Only the data source changes: `/api/mail` → `/api/messages`
- The WebSocket protocol stays the same (`chat_message` events)
- Avoids duplicate views and user confusion

### What changes per platform

**Web (CommandChat.tsx)**:
- Replace `httpClient.listMail()` calls with `api.messages.list(agentId)`
- Replace `httpClient.sendMessage()` with `api.messages.send(agentId, body)`
- Add `useChatMessages(agentId)` hook for SQLite-backed fetch + WebSocket subscription
- Agent selector gets unread count badges

**iOS (ChatView.swift / ChatViewModel.swift)**:
- Replace `apiClient.getMail()` calls with `apiClient.getMessages(agentId:)`
- Replace `apiClient.sendMail()` with `apiClient.sendMessage(agentId:body:)`
- Add unread count to agent selector
- Wire APNS deep link to open correct agent conversation

**SessionChatView (iOS) and terminal streaming (web) are NOT modified.**

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/hooks/useChatMessages.ts` | NEW: Hook for /api/messages + WebSocket subscription |
| `frontend/src/hooks/useUnreadCounts.ts` | NEW: Per-agent unread counts |
| `frontend/src/components/chat/CommandChat.tsx` | MODIFY: Switch data source, add agent scoping |
| `frontend/src/services/api.ts` | MODIFY: Add messages API client methods |
| `frontend/src/types/index.ts` | MODIFY: Add PersistentMessage, UnreadCount types |
| `frontend/src/contexts/CommunicationContext.tsx` | MODIFY: Subscribe to chat_message WS events |
| `ios/AdjutantKit/.../Models/PersistentMessage.swift` | NEW: SQLite-backed message model |
| `ios/AdjutantKit/.../Networking/APIClient+Messages.swift` | NEW: /api/messages client methods |
| `ios/Adjutant/.../Chat/ViewModels/ChatViewModel.swift` | MODIFY: Switch data source, add agent scoping |
| `ios/Adjutant/.../Chat/Views/ChatView.swift` | MODIFY: Agent selector with unread badges |
| `ios/Adjutant/.../Chat/Views/ChatBubble.swift` | MODIFY: Handle announcement/system message types |
| `ios/Adjutant/.../Chat/Services/ChatWebSocketService.swift` | MODIFY: Handle chat_message events |

## Phase 1: Shared Types & API Client

Backend API client methods for both platforms to call /api/messages.

- Web: Add `api.messages.list()`, `api.messages.send()`, `api.messages.markRead()`, `api.messages.search()` to api.ts
- Web: Add `PersistentMessage`, `UnreadCount` types
- iOS: Add `PersistentMessage` model with Codable conformance
- iOS: Add `APIClient+Messages` extension with message endpoints

## Phase 2: Web Chat Upgrade (US1)

Modify CommandChat to use SQLite-backed messages.

- Create `useChatMessages(agentId)` hook: fetch from /api/messages, subscribe to WebSocket chat_message
- Create `useUnreadCounts()` hook: per-agent unread counts from /api/messages/unread
- Modify CommandChat to use new hooks instead of mail-based fetching
- Add unread badges to agent/recipient selector
- Preserve optimistic UI, typing indicators, streaming, voice

## Phase 3: iOS Chat Upgrade (US2)

Modify ChatView/ChatViewModel to use SQLite-backed messages.

- Modify ChatViewModel: replace getMail with getMessages, scope by agent
- Modify ChatWebSocketService: handle chat_message events from MCP agents
- Add unread count display to agent selector in ChatView
- Wire APNS deep link: notification tap → open chat with correct agent
- Preserve voice input/playback, typing indicators, streaming

## Phase 4: Agent Selector Upgrade (US3)

Unread badges and agent highlighting on both platforms.

- Web: Unread count badges in recipient selector dropdown
- iOS: Unread count badges in agent picker sheet
- Both: Mark messages as read when conversation is opened (PATCH /api/messages/:id/read)
- Both: Real-time badge updates via WebSocket

## Phase 5: History & Search (US4)

Pagination and full-text search on both platforms.

- Web: Infinite scroll with cursor-based pagination (GET /api/messages?before=cursor)
- iOS: "Load earlier messages" with pagination
- Web: Search bar in chat header
- iOS: Search bar in chat view

## Phase 6: Polish

- Deduplicate messages from WebSocket + polling overlap
- Empty state UI for agents with no messages
- System/announcement message styling in chat bubbles
- Tests for new hooks and view model changes

## Parallel Execution

```
Phase 1 (Types & API) ──────────────────────────┐
                                                  ├──► Phase 4 (Unread Badges)
Phase 2 (Web Chat) ─── [after Phase 1] ─────────┤
Phase 3 (iOS Chat) ─── [after Phase 1] ─────────┤
                                                  ├──► Phase 5 (History/Search)
                                                  └──► Phase 6 (Polish)
```

- Phases 2 and 3 can run **fully in parallel** (different codebases, no file overlap)
- Phase 4 can start after Phase 1 but benefits from 2/3 being done
- Phases 5 and 6 depend on 2 and 3

## Verification Steps

- [ ] Web: Select agent → messages load from /api/messages, not /api/mail
- [ ] Web: Send message → stored in SQLite, appears optimistically
- [ ] Web: Agent sends via MCP → message appears within 2 seconds
- [ ] Web: Backend restart → all messages still visible
- [ ] iOS: Same four checks as web
- [ ] iOS: Background app → agent sends → APNS push received
- [ ] iOS: Tap push notification → opens correct agent conversation
- [ ] Both: Switch agents → correct scoped conversation loads
- [ ] Both: Unread badges show/clear correctly
- [ ] Both: Voice, typing indicators, streaming still work
