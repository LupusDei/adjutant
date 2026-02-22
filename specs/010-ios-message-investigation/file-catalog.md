# Message Pipeline File Catalog & Review Checklists

**Epic**: adj-012 | **Task**: adj-012.1.1
**Generated**: 2026-02-21

## iOS Native Layer

### ChatViewModel.swift
**Path**: `ios/Adjutant/Sources/Features/Chat/ViewModels/ChatViewModel.swift`
**Role**: Core chat state management — message fetching, lifecycle, polling, search, optimistic send
**Key Methods**: `refresh()`, `loadMoreHistory()`, `sendMessage()`, `setRecipient()`, `onAppear()`, `onDisappear()`, `observeForegroundTransitions()`
**Review Checklist**:
- [ ] Thread safety: `@Published` properties mutated from async contexts — any races?
- [ ] Lifecycle correctness: `onAppear`/`onDisappear` — does state survive view re-creation?
- [ ] Cache-to-live transition: `loadFromCache()` → `refresh()` — can stale data persist?
- [ ] Polling: fixed 30s interval, no backoff — does `lastMessageId` comparison work reliably?
- [ ] Recipient switching: `setRecipient()` — is state fully reset? `hasMore` flag?
- [ ] Error swallowing: `performAsync()` — do failures propagate to UI?

### ChatWebSocketService.swift
**Path**: `ios/Adjutant/Sources/Features/Chat/Services/ChatWebSocketService.swift`
**Role**: WebSocket message translation, event dispatch (messages, delivery confirmations, typing, streaming)
**Key Publishers**: `incomingMessage`, `deliveryConfirmation`, `streamToken`, `streamEnd`
**Review Checklist**:
- [ ] Message construction: WS payload → `PersistentMessage` — any field mapping bugs?
- [ ] Delivery confirmation: `clientId` → `serverId` mapping — can confirmations arrive for unknown clientIds?
- [ ] Stream lifecycle: `activeStream` cleared on disconnect — is partial content preserved?
- [ ] Typing indicator: 5s auto-clear — races with rapid typing events?
- [ ] Publisher retention: Combine subscriptions — any leaks?

### WebSocketClient.swift
**Path**: `ios/AdjutantKit/Sources/AdjutantKit/Networking/WebSocketClient.swift`
**Role**: Low-level WebSocket: connection, auth handshake, sequence tracking, reconnection
**Key State**: `lastSeqSeen`, reconnection backoff (1s→30s, max 10 attempts)
**Review Checklist**:
- [ ] Auth handshake: challenge → response → connected — timeout handling correct?
- [ ] Sequence tracking: `lastSeqSeen` update — any gaps in update logic?
- [ ] Reconnection: exponential backoff — does it reset on success? Max 10 attempts then what?
- [ ] Stale callbacks: `urlSession(_:didCloseWith:)` — identity check sufficient?
- [ ] Message loss: sync_response — what if server's replay buffer doesn't have the gap?
- [ ] iOS network transitions: WiFi→cellular — does URLSession handle this?

### APIClient+Messages.swift
**Path**: `ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Messages.swift`
**Role**: HTTP message endpoints — list, send, unread counts, search, mark read
**Key Methods**: `getMessages(agentId:before:beforeId:limit:)`, `sendChatMessage()`, `getUnreadCounts()`
**Review Checklist**:
- [ ] Cursor pagination: `before`/`beforeId` — what if `beforeId` is deleted?
- [ ] Response parsing: `MessagesListResponse` — does `hasMore` handle edge cases?
- [ ] Error handling: network timeout, 4xx/5xx — how do callers learn about failures?
- [ ] Concurrent requests: two `getMessages()` in flight — any races?

### ResponseCache.swift
**Path**: `ios/Adjutant/Core/Cache/ResponseCache.swift`
**Role**: Dual-layer cache — in-memory `@Published` + UserDefaults persistence (max 50 messages)
**Review Checklist**:
- [ ] Cold start: `loadPersistedChatMessages()` — returns empty if no cache, UI shows blank?
- [ ] Persistence frequency: called after every WS message — UserDefaults write perf?
- [ ] Memory: in-memory array grows unbounded — no eviction?
- [ ] Agent scoping: cache is global — switching agents shows wrong messages?
- [ ] Cache coherence: cached data stale after server-side changes?

### PersistentMessage.swift
**Path**: `ios/AdjutantKit/Sources/AdjutantKit/Models/PersistentMessage.swift`
**Role**: Message data model — Codable, Identifiable, Hashable
**Review Checklist**:
- [ ] Date parsing: ISO8601 with fractional seconds — matches server format?
- [ ] Hashable: based on `id` — correct for deduplication?
- [ ] Codable round-trip: UserDefaults persistence — any fields lost?

### ChatView.swift
**Path**: `ios/Adjutant/Sources/Features/Chat/Views/ChatView.swift`
**Role**: SwiftUI chat UI — scroll management, pull-to-refresh, load-more trigger
**Review Checklist**:
- [ ] Scroll-to-bottom: triggers on `messages.count` change — correct anchor?
- [ ] Load-more trigger: visible when? Auto-triggers?
- [ ] Pull-to-refresh: calls `viewModel.refresh()` — blocks UI?
- [ ] Memory: all messages in LazyVStack — performance at scale?

### App Lifecycle Files
**Paths**:
- `ios/Adjutant/App/AdjutantApp.swift` — Scene phase management, SSE lifecycle
- `ios/Adjutant/App/AppDelegate.swift` — APNS registration, remote notification handling
- `ios/Adjutant/Core/Services/BackgroundTaskService.swift` — BGTaskScheduler, background refresh
- `ios/Adjutant/Core/Services/NotificationService.swift` — Local notification scheduling, tap handling
**Review Checklist**:
- [ ] Scene phase: `.background` stops SSE — messages lost in gap?
- [ ] APNS: `handleChatMessageNotification` only schedules local notif — doesn't fetch message?
- [ ] Background refresh: 15min interval, only mail/beads — no chat sync?
- [ ] Notification tap: posts `.navigateToChat` — race with `ChatViewModel.onAppear`?
- [ ] Cold start from notification: `coordinator.pendingChatAgentId` — set before ChatView creates?

## Backend Layer

### ws-server.ts
**Path**: `backend/src/services/ws-server.ts`
**Role**: WebSocket server — auth, sequence numbering, replay buffer, broadcast, rate limiting
**Constants**: PING 30s, AUTH_TIMEOUT 10s, REPLAY_BUFFER 1000, REPLAY_TTL 1hr, RATE 60msg/min
**Review Checklist**:
- [ ] Broadcast: `wsBroadcast()` — all authenticated clients get every message?
- [ ] Replay buffer: 1000 msgs or 1hr — enough for long disconnects?
- [ ] Sequence gaps: `handleSync()` — what if requested range is outside buffer?
- [ ] Rate limiting: sliding window — per-client or global?
- [ ] Concurrent clients: multiple WS from same user — all get messages?
- [ ] Memory: replay buffer in memory — grows unbounded within TTL?

### message-store.ts
**Path**: `backend/src/services/message-store.ts`
**Role**: SQLite message persistence — CRUD, cursor pagination, FTS5, unread counts
**Review Checklist**:
- [ ] Pagination: `(created_at, id)` composite cursor — handles same-second correctly?
- [ ] FTS5: triggers keep it in sync — any desync scenarios?
- [ ] Unread counts: query correctness — filters by `delivery_status`?
- [ ] Thread queries: `getThreads()` — aggregation correct?
- [ ] Concurrent writes: SQLite WAL mode? Multiple writers?

### messages.ts (route)
**Path**: `backend/src/routes/messages.ts`
**Role**: REST endpoints — list, get, unread, threads, mark-read, send
**Review Checklist**:
- [ ] Send: broadcasts + tmux delivery — any failure modes?
- [ ] List: query params → `getMessages()` — parameter validation complete?
- [ ] Unread: `getUnreadCounts()` — matches frontend expectations?
- [ ] Mark-read: bulk `markAllRead()` — atomic?

### messaging.ts (MCP tools)
**Path**: `backend/src/services/mcp-tools/messaging.ts`
**Role**: MCP tools for agent messaging — send_message, read_messages, list_threads
**Review Checklist**:
- [ ] Identity: `getAgentBySession()` — reliable? What if session unknown?
- [ ] APNS: `sendNotificationToAll()` — failure handling?
- [ ] Broadcast: `wsBroadcast()` — called after store insert — any race?

## Frontend (Web) Layer

### useChatMessages.ts
**Path**: `frontend/src/hooks/useChatMessages.ts`
**Role**: Message state management — fetch, pagination, optimistic UI, deduplication
**Review Checklist**:
- [ ] Deduplication: by message ID — handles optimistic → confirmed transition?
- [ ] Pagination: cursor from oldest message — what if message removed?
- [ ] Agent switch: state reset — all fields cleared?
- [ ] WS subscription: `useCommunication().subscribe()` — cleanup on unmount?

### useChatWebSocket.ts
**Path**: `frontend/src/hooks/useChatWebSocket.ts`
**Role**: Direct WebSocket management for CommandChat
**Review Checklist**:
- [ ] Reconnection: exponential backoff — max attempts?
- [ ] Auth: API key handling — secure?
- [ ] Callbacks: stable references? Re-subscription on change?

### CommunicationContext.tsx
**Path**: `frontend/src/contexts/CommunicationContext.tsx`
**Role**: WS/SSE/polling fallback chain — connection state, message routing
**Review Checklist**:
- [ ] Fallback chain: WS fail → SSE → polling — timing correct?
- [ ] Priority persistence: localStorage — survives page reload?
- [ ] Subscriber pattern: Set of callbacks — any leaks on unmount?

### CommandChat.tsx
**Path**: `frontend/src/components/chat/CommandChat.tsx`
**Role**: SMS-style chat UI — optimistic send, voice input/output
**Review Checklist**:
- [ ] Optimistic send: `addOptimistic()` → `confirmDelivery()` / `markFailed()` — all paths covered?
- [ ] Double send: WS + HTTP — still happening after adj-1c2 fix?
