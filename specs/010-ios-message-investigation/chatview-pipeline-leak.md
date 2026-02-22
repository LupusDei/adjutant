# ChatView Pipeline Feed Leak Investigation

**Bead**: adj-7qa
**Investigator**: Claude Opus 4.6 (chatview-investigator)
**Date**: 2026-02-22

---

## Executive Summary

The main "ChatView" in the iOS app appears to show pipeline/session feed content because **in non-gastown (swarm) deployment mode, the `.chat` tab renders `UnifiedChatView` instead of `ChatView`**. `UnifiedChatView` is a session-based view that displays parsed terminal output events (messages, user input, tool use, status changes) from a live tmux session via WebSocket session streaming. This is not a data leak -- it is an architectural design choice where the chat tab serves dual purpose depending on deployment mode. However, it creates confusion because the user expects the chat tab to always show the persistent message-based direct messaging interface.

There are also **two secondary leak paths** where non-chat content enters the actual `ChatView` via the REST API: announcements stored in the messages table, and the `announce` MCP tool's broadcast using `type: "message"` (though the WS-side leak was patched in commit `c739cc0`).

---

## Root Cause Analysis

### Primary Root Cause: Deployment Mode Tab Routing

**File**: `/Users/Reason/code/ai/adjutant/ios/Adjutant/Core/Navigation/MainTabView.swift:108-112`

```swift
case .chat:
    if AppState.shared.deploymentMode == .gastown {
        ChatView(apiClient: AppState.shared.apiClient)
    } else {
        UnifiedChatView()
    }
```

When `deploymentMode == .swarm` (any non-gastown mode), the `.chat` tab renders `UnifiedChatView()` instead of `ChatView()`. `UnifiedChatView` is a session-based view that:

1. Connects to a live agent tmux session via WebSocket `session_connect`
2. Receives `session_output` (structured events) and `session_raw` (terminal output)
3. Filters events to show `.message`, `.userInput`, and `.status` types as chat bubbles
4. This IS the pipeline/session feed content the user sees

The `UnifiedChatView` was intentionally designed to show session output as a "chat-like" interface for swarm mode where agents don't use MCP messaging. But for users who expect the `.chat` tab to show persistent message-based chat (like the gastown `ChatView`), this looks like a pipeline leak.

### Secondary Root Cause: Announcements in Messages Table

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/mcp-tools/status.ts:156-163`

The `announce` MCP tool inserts announcements into the messages table with `role: "announcement"`:

```typescript
const message = store.insertMessage({
    agentId,
    recipient: "user",
    role: "announcement",
    body: formattedBody,
    eventType: "announcement",
    metadata: { announcementType: type, beadId },
});
```

The `getMessages()` query (after the conversation scoping fix in commit `e3655a3`) returns all messages where `agent_id = ? OR (role = 'user' AND recipient = ?)`. Since announcements have `agent_id = <agentName>`, they ARE returned in the conversation query for that agent. These announcements contain operational content like `[COMPLETION] Task done: ...` or `[BLOCKER] Need help with: ...`, which could look like pipeline/session content.

The iOS `ChatView` displays ALL messages from the API without filtering by role, so announcements appear as regular chat bubbles.

### Tertiary Path (Patched): WS `type: "message"` Broadcast

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/mcp-tools/status.ts:165-172`

The `announce` tool broadcasts with `type: "message"` (NOT `type: "chat_message"`):

```typescript
wsBroadcast({
    type: "message",
    id: message.id,
    from: agentId,
    body: formattedBody,
    timestamp: message.createdAt,
    metadata: { type: "announcement", announcementType: type, beadId },
});
```

**This was patched in commit `c739cc0`**: The `handleLegacyChatMessage` handler for `type: "message"` was removed from `ChatWebSocketService.swift`, so these broadcasts now fall through to `default: break` and are ignored. However, the announcement is still stored in the messages table and appears via the REST API path (secondary root cause above).

---

## Code Path Traces

### Path 1: UnifiedChatView Session Pipeline (Primary)

```
User taps Chat tab (swarm mode)
  -> MainTabView.swift:111 renders UnifiedChatView()
    -> UnifiedChatView creates SessionLoader
      -> SessionLoader.refresh() fetches sessions from API
      -> SessionLoader creates WebSocketClient, calls connect()
    -> UnifiedChatContent creates SessionChatViewModel
      -> SessionChatViewModel.onAppear() calls connectToSession()
        -> WebSocketClient.sendSessionConnect(sessionId:, replay: true)
          -> Backend ws-server.ts handleSessionConnect()
            -> bridge.connectClient() subscribes to session output
            -> bridge.connector.onOutput(handler) forwards output to client
              -> session_output events with parsed OutputEventDTOs
              -> session_raw events with raw terminal lines
        -> WebSocketClient.handleRawMessage routes:
          -> "session_output" -> sessionEventsSubject (NOT messageSubject)
          -> "session_raw" -> sessionOutputSubject (NOT messageSubject)
        -> SessionChatViewModel subscribes to sessionEventsSubject
          -> appendEvents() maps DTOs to OutputEvent enum cases
    -> UnifiedChatContent.chatEvents filters to [.message, .userInput, .status]
    -> ForEach(chatEvents) renders OutputEventRenderer for each
```

The user sees `.message` content (agent responses), `.userInput` content (user typed inputs), and `.status` events (idle/working state changes). These are session pipeline events rendered as chat bubbles.

### Path 2: Announcements via REST API (Secondary)

```
Agent calls announce MCP tool
  -> status.ts:156 inserts into messages table (role: "announcement")
  -> status.ts:165 wsBroadcast type: "message" (ignored by ChatWebSocketService)
...
User opens ChatView (gastown mode) or pulls to refresh
  -> ChatViewModel.refresh()
    -> apiClient.getMessages(agentId: selectedRecipient)
      -> GET /api/messages?agentId=<agent>
        -> message-store.ts getMessages()
          -> WHERE (agent_id = ? OR (role = 'user' AND recipient = ?))
          -> Returns ALL messages for that agent, including role="announcement"
    -> messages array includes announcements like "[COMPLETION] Build done: ..."
    -> ChatView renders all messages via ForEach(viewModel.messages)
    -> ChatBubble renders announcement body as regular chat message
```

### Path 3: WebSocket `type: "message"` (Patched)

```
Agent calls announce MCP tool
  -> status.ts:165 wsBroadcast({ type: "message", ... })
  -> Broadcast to all authenticated WS clients
  -> WebSocketClient.handleRawMessage()
    -> msg.type == "message" -> falls to default case -> messageSubject.send(msg)
  -> ChatWebSocketService.handleServerMessage()
    -> msg.type == "message" -> falls to default case -> break (PATCHED in c739cc0)
    -> BEFORE patch: was handled by handleLegacyChatMessage -> created PersistentMessage -> incomingMessage.send()
    -> AFTER patch: ignored
```

---

## Evidence

### Evidence 1: Tab routing in MainTabView

**File**: `/Users/Reason/code/ai/adjutant/ios/Adjutant/Core/Navigation/MainTabView.swift`
**Lines**: 108-112

In swarm mode, the chat tab renders `UnifiedChatView` which shows session pipeline content by design.

### Evidence 2: UnifiedChatView shows filtered session events

**File**: `/Users/Reason/code/ai/adjutant/ios/Adjutant/Features/Sessions/UnifiedChatView.swift`
**Lines**: 129-138

```swift
private var chatEvents: [OutputEvent] {
    viewModel.outputEvents.filter { event in
        switch event {
        case .message, .userInput, .status:
            return true
        default:
            return false
        }
    }
}
```

This filter selects `.message` (agent responses from terminal), `.userInput` (user text sent to terminal), and `.status` (agent state changes). These are session pipeline events, NOT persistent chat messages.

### Evidence 3: SessionChatViewModel receives session events

**File**: `/Users/Reason/code/ai/adjutant/ios/Adjutant/Features/Sessions/SessionChatViewModel.swift`
**Lines**: 176-183

```swift
wsClient.sessionEventsSubject
    .filter { [weak self] in $0.sessionId == self?.session.id }
    .receive(on: DispatchQueue.main)
    .sink { [weak self] event in
        self?.appendEvents(event.events)
    }
    .store(in: &cancellables)
```

Session events flow through `sessionEventsSubject` (NOT `messageSubject`), which is the correct separation. But `UnifiedChatView` deliberately renders these as chat bubbles.

### Evidence 4: Announcements stored as messages

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/mcp-tools/status.ts`
**Lines**: 156-163

Announcements are inserted with `role: "announcement"` and `eventType: "announcement"` but the iOS `ChatView` does not filter by role.

### Evidence 5: No message type filtering in ChatView

**File**: `/Users/Reason/code/ai/adjutant/ios/Adjutant/Sources/Features/Chat/Views/ChatView.swift`
**Lines**: 242-258

```swift
ForEach(viewModel.messages) { message in
    ChatBubble(message: message, ...)
}
```

All messages are rendered regardless of `role` or `eventType`.

### Evidence 6: No message type filtering in ChatViewModel

**File**: `/Users/Reason/code/ai/adjutant/ios/Adjutant/Sources/Features/Chat/ViewModels/ChatViewModel.swift`
**Lines**: 288-335

`performRefresh()` assigns all API messages to `self.messages` without filtering by role or event type.

### Evidence 7: WebSocket correctly separates session from chat

**File**: `/Users/Reason/code/ai/adjutant/ios/AdjutantKit/Sources/AdjutantKit/Networking/WebSocketClient.swift`
**Lines**: 462-539

The `handleRawMessage()` switch correctly routes:
- `session_output`, `session_raw`, `session_connected`, `session_disconnected`, `session_status`, `session_ended` -> dedicated session subjects
- `chat_message`, `delivered`, `typing`, `stream_token`, `stream_end` -> `messageSubject` (default case)

These are properly separated. The session pipeline does NOT leak into `messageSubject`.

---

## Why Previous Fixes Didn't Work

### Commit c739cc0: "route WS messages through SQLite to prevent session output leak"

This commit addressed **two specific issues**:

1. **Backend**: Changed WS `handleMessage` to persist messages to SQLite and broadcast as `type: "chat_message"` instead of the old `type: "message"`. This was a real bug where user-sent WS messages were broadcast as `type: "message"`, which the iOS side was treating as chat messages.

2. **iOS**: Removed `handleLegacyChatMessage` from `ChatWebSocketService` that handled `type: "message"`. This means announcements broadcast as `type: "message"` are no longer processed through WebSocket.

**What it missed:**

1. **The `UnifiedChatView` substitution**: The fix focused on the WS message type routing but didn't address the fact that in swarm mode, the entire chat tab is replaced with a session-based view (`UnifiedChatView`). This is the PRIMARY source of "pipeline content in the chat tab."

2. **Announcements via REST API**: Announcements are stored in the messages table and returned by `getMessages()`. The WS-side leak was patched, but the REST API still returns announcements mixed with regular chat messages. There's no role filtering on the iOS side.

3. **Announcement broadcast still uses `type: "message"`**: The `announce` tool in `status.ts:166` still broadcasts with `type: "message"` instead of `type: "chat_message"`. While the iOS `ChatWebSocketService` now ignores this type, the broadcast type is inconsistent with the pattern established by the fix. It should either be `type: "chat_message"` (if announcements should appear in real-time) or removed entirely (if they should only appear via REST API refresh).

### Commits 216d0b7 and d6d88e8: iOS message fixes

These commits addressed conversation scoping, pagination, merge refresh, dedup, and various UX improvements. They did NOT address:

1. The `UnifiedChatView` substitution for the chat tab in swarm mode
2. Role-based filtering of messages in `ChatView`

---

## Proposed Fix

### Fix A: Allow ChatView in All Modes (Recommended)

**File**: `/Users/Reason/code/ai/adjutant/ios/Adjutant/Core/Navigation/MainTabView.swift`

Always render `ChatView` for the `.chat` tab, regardless of deployment mode. Move `UnifiedChatView` to a separate tab or make it accessible from within `ChatView` via a button/toggle:

```swift
case .chat:
    ChatView(apiClient: AppState.shared.apiClient)
```

This ensures the chat tab always shows the persistent message-based interface. Users can access session terminal views through the existing session switcher button already present in `ChatView`'s header (line 172-174):

```swift
SessionSwitcherButton(onSessionSelected: { session in
    selectedSession = session
})
```

The `SessionSwitcherButton` already opens `SessionChatView` as a `fullScreenCover`, which is the proper session terminal view.

**Impact**: Eliminates the primary pipeline content in the chat tab. Users in swarm mode get the same persistent messaging interface as gastown mode.

**Risk**: Swarm-mode users who relied on `UnifiedChatView` as their primary interface would need to use the session switcher button or a separate sessions tab instead.

### Fix B: Filter Messages by Role in ChatView

**File**: `/Users/Reason/code/ai/adjutant/ios/Adjutant/Sources/Features/Chat/ViewModels/ChatViewModel.swift`

In `handleIncomingMessage()` and `performRefresh()`, filter out non-chat roles:

```swift
// In performRefresh(), after fetching serverMessages:
serverMessages = serverMessages.filter { msg in
    msg.role == .user || msg.role == .agent
    // Optionally include .system and .announcement:
    // || msg.role == .system || msg.role == .announcement
}
```

And in `handleIncomingMessage()`:

```swift
private func handleIncomingMessage(_ message: PersistentMessage) {
    // Only show chat messages (user/agent), not announcements or system events
    guard message.role == .user || message.role == .agent else { return }
    // ... rest of existing logic
}
```

Alternatively, if announcements should appear in chat but be visually distinct, modify `ChatBubble` to render announcements with a different style (banner/system message format instead of chat bubble).

**Impact**: Prevents announcements and any future non-chat message types from appearing as regular chat bubbles.

### Fix C: Fix Announce Broadcast Type

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/mcp-tools/status.ts:165-172`

Change the announcement broadcast from `type: "message"` to `type: "chat_message"` for consistency, or remove it if announcements should only appear via REST refresh:

```typescript
// Option 1: Consistent broadcast type
wsBroadcast({
    type: "chat_message",  // was "message"
    id: message.id,
    from: agentId,
    to: "user",
    body: formattedBody,
    timestamp: message.createdAt,
    metadata: { type: "announcement", announcementType: type, beadId },
});

// Option 2: Remove broadcast (rely on REST refresh)
// Delete the wsBroadcast call entirely
```

**Impact**: Either makes announcements show up consistently via both WS and REST, or removes the orphaned `type: "message"` broadcast that no client currently processes.

---

## Summary

| Issue | Severity | Source | Fix |
|-------|----------|--------|-----|
| UnifiedChatView replaces ChatView in swarm mode | **Critical** (primary cause) | MainTabView.swift:108-112 | Fix A: Always render ChatView |
| Announcements appear as chat messages via REST API | **Medium** (secondary cause) | status.ts:156-163, ChatViewModel.swift:288-335 | Fix B: Filter by role |
| Announce broadcast uses `type: "message"` (orphaned) | **Low** (patched on client side) | status.ts:166 | Fix C: Change to chat_message or remove |
| Session output leaks via WebSocket | **Resolved** | c739cc0 patch | Already fixed |
| Conversation scoping bug | **Resolved** | e3655a3 patch | Already fixed |
