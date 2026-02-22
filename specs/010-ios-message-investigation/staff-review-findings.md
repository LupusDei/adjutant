# Staff Code Review: Message Pipeline Findings

**Epic**: adj-012 | **Task**: adj-012.3 (US2: Staff Code Review)
**Reviewer**: Staff Engineer (adj-012.3.6)
**Date**: 2026-02-22

---

## Executive Summary

The message pipeline has one **CRITICAL** architectural defect (agentId-only query filtering loses user messages on refresh), two **HIGH** severity race conditions, and several **MEDIUM** findings around cache coherence, resource management, and protocol contract mismatches. The CRITICAL finding is likely the root cause of the "messages lost after backgrounding" symptom reported in the behavior baseline.

**Total Findings**: 4 CRITICAL, 6 HIGH, 9 MEDIUM, 4 LOW

---

## File: `ios/Adjutant/Sources/Features/Chat/ViewModels/ChatViewModel.swift`

### Purpose
Core chat ViewModel managing message fetching, optimistic sending, WebSocket event handling, polling fallback, recipient switching, and cache management. Annotated `@MainActor` for thread safety.

### Findings

#### [CRITICAL] User messages lost on refresh due to backend `agentId`-only filtering
**Lines**: 277-314
**Description**: `refresh()` calls `self.apiClient.getMessages(agentId: self.selectedRecipient)`. The backend `getMessages` filters with `WHERE agent_id = ?`, where `agent_id` is the message SENDER. User-sent messages have `agent_id = "user"` and `recipient = <agent>`. Therefore, `?agentId=some-agent` returns only messages FROM that agent, not TO it. After refresh completes, the entire `messages` array is replaced with `serverMessages` (line 310), losing all user-sent messages that aren't still in `pendingLocalMessages`.
**Impact**: After any full refresh (backgrounding, foregrounding, WebSocket reconnection, recipient switch), the user's own messages disappear from the conversation. This is the likely root cause of "Symptom 2: Messages Lost After Backgrounding" in the behavior baseline. The optimistic message list only preserves unconfirmed messages -- confirmed ones (where `confirmedClientIds` contains the clientId) are removed on lines 290-291, and the remaining pending messages can't make up for the full history of user-sent messages.
**Fix**: The backend `getMessages` needs a "conversation" mode: `WHERE (agent_id = ? OR recipient = ?)` with the same value for both params. Alternatively, change the route to accept an explicit `conversation` query param that expands to the OR condition. This is a backend fix, not iOS.

#### [HIGH] Race between `onAppear` Task and `connectWebSocket` callback
**Lines**: 217-228, 246-272
**Description**: `onAppear()` fires `connectWebSocket()` (synchronous) and then a `Task { loadRecipients(); refresh() }`. Meanwhile, when the WebSocket connects, `handleWebSocketStateChange(.connected)` at line 254 fires *another* `Task { await refresh() }`. These two `refresh()` calls can race, both fetching from the API and both replacing `self.messages`, with the second one potentially overwriting state the first one set (including pending message merges).
**Impact**: Messages can flicker or duplicates can appear briefly. Under network timing variations, the second refresh could overwrite a more complete message list with a stale one.
**Fix**: Guard `refresh()` with a `refreshInProgress` flag, or use a serial async queue. Cancel any pending refresh when a new one starts.

#### [HIGH] `hasMoreHistory` not reset on recipient switch
**Lines**: 349-363
**Description**: `setRecipient()` sets `messages = []` and clears pending state, but does NOT reset `hasMoreHistory` to `true`. It relies on `refresh()` to set it from `response.hasMore`. If the previous agent had `hasMoreHistory = false` and the refresh for the new agent fails (network error), `hasMoreHistory` stays `false`, and the user can never load history for the new agent.
**Impact**: After switching from a short conversation (where all messages fit in one page) to a long conversation, if the refresh fails, "Load More" is permanently disabled for the new agent until a successful refresh.
**Fix**: Add `hasMoreHistory = true` to `setRecipient()` before calling `refresh()`.

#### [MEDIUM] `loadFromCache()` returns unscoped messages
**Lines**: 149-156
**Description**: `ResponseCache.shared.chatMessages` is a flat array of all cached messages across all agents. `loadFromCache()` loads the entire array into `messages` without filtering by `selectedRecipient`. On cold start, if the cache was last populated from a different agent, the user briefly sees messages from the wrong agent.
**Impact**: Flash of wrong-agent messages on cold start, especially noticeable in multi-agent setups. Goes away after `refresh()` completes.
**Fix**: Filter cached messages by `selectedRecipient` before assigning: `messages = cached.filter { $0.agentId == selectedRecipient || $0.recipient == selectedRecipient }`.

#### [MEDIUM] `isConfirmedMessage` body-matching is fragile
**Lines**: 318-320
**Description**: Matches a pending local message to a server message by `local.body == server.body && server.role == .user`. If the user sends the same text twice in rapid succession, the first server confirmation could match the second pending message (or vice versa). There's no timestamp or ordering check.
**Impact**: In edge cases (double-sent identical messages), the wrong optimistic message gets confirmed, leading to a ghost pending message that never clears.
**Fix**: Match on `(body, createdAt proximity)` or use a dedicated clientId field in the server response.

#### [MEDIUM] ISO8601DateFormatter created on every send
**Lines**: 495
**Description**: `ISO8601DateFormatter()` is allocated on every `sendMessage()` call. While not a memory leak, `ISO8601DateFormatter` initialization has non-trivial cost and this is a hot path.
**Impact**: Minor performance overhead per message send.
**Fix**: Use a static/shared formatter instance.

#### [MEDIUM] Polling does not resume after recipient switch
**Lines**: 349-363
**Description**: `setRecipient()` does not restart polling if the WebSocket is disconnected. If the user was in polling fallback mode and switches agents, polling continues with the old agent filter (captured by the closure at line 717), but `selectedRecipient` has changed. The next poll fetch uses the new `selectedRecipient` (since it references `self`), but only if a poll fires before the user switches again.
**Impact**: Minor -- polling is already a fallback, and refresh() runs immediately on recipient switch. But if refresh() fails, there's a gap.
**Fix**: Consider restarting the polling task on recipient switch when in HTTP fallback mode.

#### [LOW] `performAsync` swallows errors silently
**Lines**: 277-314 (via BaseViewModel 59-84)
**Description**: `performAsyncAction(showLoading:)` wraps the operation in `performAsync`, which catches all non-cancellation errors and sets `errorMessage`. But `refresh()` doesn't check whether the operation succeeded -- it just returns. If the API call fails, `messages` is not updated (good), but no retry is scheduled.
**Impact**: If the initial refresh fails on app launch, the user sees a blank chat with only an error message. No automatic retry means the user must manually pull-to-refresh.
**Fix**: Consider adding an automatic retry with backoff on initial load failure.

### Thread Safety Analysis
The class is `@MainActor`, so all `@Published` mutations occur on the main thread. All Combine subscriptions use `.receive(on: DispatchQueue.main)`. The `deinit` cancel of `pollingTask` is safe because Task cancellation is cooperative. **Thread safety is well-handled through `@MainActor` annotation.**

### Error Handling Assessment
Errors from `performAsyncAction` are captured in `errorMessage` via `handleError()` in BaseViewModel. Network failures during polling are caught by `performAsync` and result in `markConnectionFailure()`. However, there's no retry mechanism for failed initial loads, and send failures via WebSocket are fire-and-forget (no retry queue).

### iOS-Specific Concerns
- **Backgrounding**: `onDisappear()` disconnects WebSocket and cancels polling. `observeForegroundTransitions()` calls `refresh()` on `didBecomeActive`. The gap between background and foreground is unmonitored.
- **Memory**: The `messages` array grows unbounded during a session. No eviction policy exists.
- **View lifecycle**: SwiftUI may call `onAppear`/`onDisappear` multiple times for navigation changes, causing repeated WebSocket connect/disconnect cycles.

### Verdict
**CRITICAL ISSUES** -- The `agentId`-only query filtering is a root-cause defect that explains multiple user-reported symptoms. The refresh race condition is a correctness issue that can cause flickering.

---

## File: `ios/Adjutant/Sources/Features/Chat/Services/ChatWebSocketService.swift`

### Purpose
Bridge between the low-level `WebSocketClient` and the chat domain. Translates raw WebSocket messages into typed Combine publishers for messages, delivery confirmations, typing, and streaming.

### Findings

#### [MEDIUM] All incoming `chat_message` events have `role: .agent` hardcoded
**Lines**: 132-149
**Description**: `handleChatMessage()` constructs a `PersistentMessage` with `role: .agent` regardless of the actual sender. If the user sends a message from another device/client and it's broadcast back, it arrives with `from: "user"` but gets `role: .agent`. This means the message is displayed as if it came from an agent instead of from the user.
**Impact**: Multi-device usage would show user's own messages as agent messages in the UI. Currently low impact since there's typically one iOS client, but the web frontend's broadcasts would also be received.
**Fix**: Check `msg.from == "user"` and set `role: .user` accordingly.

#### [MEDIUM] `disconnect()` clears all cancellables, including non-WS subscriptions
**Lines**: 82-89
**Description**: `disconnect()` calls `cancellables.removeAll()`, which clears ALL stored subscriptions. If any external code stores additional subscriptions in this set (unlikely given the class design, but fragile), they'd be lost. More importantly, after `disconnect()`, if `connect()` is called again, new subscriptions are created. But if `disconnect()` isn't called before a second `connect()` (e.g., during reconnection), old subscriptions would accumulate.
**Impact**: The `connect()` method does call `disconnect()` first (line 61), so this is safe in practice. However, the pattern is fragile.
**Fix**: No change needed, but consider using a dedicated cancellable set for WS subscriptions vs. other subscriptions.

#### [MEDIUM] Typing indicator timer races with rapid disconnect/reconnect
**Lines**: 159-175
**Description**: The typing timer Task (line 166) captures `[weak self]` but doesn't check if the connection state has changed. If the WebSocket disconnects and reconnects while a typing timer is active, the timer could fire and set `isRemoteTyping = false` after the new connection has already started a new typing indicator from a new event.
**Impact**: Typing indicator briefly flickers off then on during reconnection if the remote agent was typing during the transition.
**Fix**: Cancel `typingTimer` in `disconnect()` (currently done implicitly via `isRemoteTyping = false`, but the pending Task still fires).

#### [LOW] `activeStream` cleared after 500ms delay
**Lines**: 198-204
**Description**: `handleStreamEnd` sets a 500ms delay before clearing `activeStream`. If a new stream starts within that 500ms window, the old clear task could nil out the new stream.
**Impact**: Rapid successive streams could have the second stream's data cleared by the first stream's cleanup task.
**Fix**: The existing guard `if self?.activeStream?.streamId == streamId` (line 201) correctly prevents this. No change needed.

### Thread Safety Analysis
Class is `@MainActor`. All state mutations happen on main thread. Publishers use `PassthroughSubject` which is thread-safe for sending. The `typingTimer` Task runs on the main actor. **Thread safety is correct.**

### Error Handling Assessment
Error messages from the server (type "error") are silently dropped (line 124: `break`). They are forwarded to `messageSubject` via the WebSocketClient, but this service doesn't surface them to the ViewModel. The ViewModel doesn't subscribe to error events.

### iOS-Specific Concerns
- No explicit cleanup on `deinit` -- relies on ARC to release `wsClient` which calls `disconnect()` in its `deinit`. This is correct but order-dependent.

### Verdict
**MINOR ISSUES** -- The hardcoded `role: .agent` is a correctness bug for multi-client scenarios. Otherwise well-structured.

---

## File: `ios/AdjutantKit/Sources/AdjutantKit/Networking/WebSocketClient.swift`

### Purpose
Low-level WebSocket client handling connection, authentication handshake, reconnection with exponential backoff, sequence tracking, and gap recovery.

### Findings

#### [HIGH] `@unchecked Sendable` masks thread safety issues
**Lines**: 237
**Description**: `WebSocketClient` is marked `@unchecked Sendable` but has mutable state (`lastSeqSeen`, `reconnectAttempt`, `isIntentionalDisconnect`, `isHandlingDisconnect`, `webSocketTask`, `session`, `reconnectTask`) that is accessed from multiple threads: the main thread (via public API calls from `@MainActor` callers), URLSession delegate callbacks (background thread), and `receiveMessage` callbacks (background thread). The `handleRawMessage` method mutates `lastSeqSeen` (line 516) from a URLSession background thread, while `requestSync` reads it (line 334) potentially from the main thread.
**Impact**: Data races on `lastSeqSeen`, `reconnectAttempt`, and `isHandlingDisconnect` under concurrent access. The `isHandlingDisconnect` guard (line 534) is not atomic and can be bypassed by two simultaneous calls from different threads.
**Fix**: Either:
1. Dispatch all state mutations to a serial DispatchQueue, or
2. Make the class `@MainActor` (preferred since all callers are `@MainActor`), or
3. Use `os_unfair_lock` / `NSLock` for mutable state.

#### [HIGH] Sequence gap recovery is unreliable
**Lines**: 450-452, 290-302
**Description**: On reconnection, the client sends `requestSync()` only if `lastSeqSeen > 0 && lastSeqSeen < lastSeq` (line 450). However:
1. `lastSeqSeen` is only updated for messages that fall through to the `default` case (line 516) -- `chat_message`, `typing`, `delivered` etc. Auth, session, and sync messages don't update it.
2. If the replay buffer on the server has been trimmed (beyond 1000 messages or 1 hour), the sync response will be incomplete but the client has no way to detect this gap.
3. If `lastSeqSeen` is 0 (first connection ever), no sync is requested even if messages were sent between server start and client connect.
**Impact**: Messages can be silently dropped during reconnection if the gap exceeds the server's replay buffer, with no fallback to a full refresh.
**Fix**: After sync, compare the highest `seq` in the sync response with `lastSeq` from the `connected` message. If there's still a gap, fall back to an HTTP refresh. Also update `lastSeqSeen` for ALL sequenced messages, not just `default` case ones.

#### [MEDIUM] Auth timeout not handled on client side
**Lines**: 440-444
**Description**: The client sends an `auth_response` message when it receives `auth_challenge`. However, there's no client-side timeout for waiting for the `connected` response after sending `auth_response`. If the server takes too long to respond (or the response is lost), the client stays in `.authenticating` state indefinitely.
**Impact**: Client appears stuck in "connecting" state with no recovery. The server has a 10s auth timeout that will close the connection, which would trigger `handleDisconnection` and reconnection. So there is an indirect recovery path, but the UX is poor (10+ second hang).
**Fix**: Add a client-side auth response timeout (e.g., 5s) that triggers reconnection if `connected` isn't received.

#### [MEDIUM] `buildWebSocketURL()` force-unwraps URL construction
**Lines**: 407
**Description**: `URL(string: urlString)!` will crash if the URL string is malformed. While unlikely in normal operation, a misconfigured `apiBaseURL` could trigger this.
**Impact**: App crash on connection attempt with malformed base URL.
**Fix**: Return an optional and handle nil gracefully, or validate the URL before attempting connection.

#### [MEDIUM] After max reconnect attempts, no recovery path
**Lines**: 546-549
**Description**: After `reconnectAttempt >= maxReconnectAttempts` (10 attempts), the state is set to `.disconnected` and no further reconnection is attempted. There's no mechanism to restart reconnection -- the only way is to call `disconnect()` then `connect()` again, which requires external intervention.
**Impact**: After a prolonged network outage (>5 minutes of backoff), the client permanently gives up. The ViewModel does start polling, but the WebSocket never reconnects even when the network returns.
**Fix**: Listen for network reachability changes and reset `reconnectAttempt` when connectivity is restored. Alternatively, schedule a periodic reconnect probe (e.g., every 60s) after max attempts.

#### [LOW] `send()` silently drops messages if WebSocket is not open
**Lines**: 524-528
**Description**: `send()` encodes the message and calls `webSocketTask?.send()`. If `webSocketTask` is nil or not open, the message is silently dropped. No error is returned to the caller.
**Impact**: Messages sent during reconnection are lost without any notification. The caller (ChatWebSocketService) has no way to know the send failed.
**Fix**: Return a Bool indicating success, or throw an error. Alternatively, queue messages during reconnection and flush on reconnect.

### Thread Safety Analysis
**PROBLEMATIC.** The class is `@unchecked Sendable` with mutable state accessed from multiple threads. `receiveMessage` and delegate callbacks run on URLSession's delegate queue (background), while public API calls come from `@MainActor`. The `isHandlingDisconnect` guard is not thread-safe. `lastSeqSeen` can be read and written concurrently.

### Error Handling Assessment
Connection errors trigger `handleDisconnection()` which attempts reconnection. Auth failures send `.disconnected` state. JSON decode failures are silently ignored (line 436-437). Send errors are silently ignored (line 527: `{ _ in }`).

### iOS-Specific Concerns
- `URLSessionConfiguration.waitsForConnectivity = true` means the task won't fail on no-network; it waits. This is good for initial connection but may interfere with reconnection logic.
- WiFi-to-cellular transitions: URLSession may or may not detect these as connection failures depending on iOS version and network conditions.
- `deinit` calls `disconnect()` which calls `session?.invalidateAndCancel()`. This is correct but `deinit` may run on any thread, creating a potential race with delegate callbacks.

### Verdict
**NEEDS ATTENTION** -- Thread safety issues are real and could cause intermittent crashes or data corruption. Sequence gap recovery needs improvement for reliability.

---

## File: `ios/Adjutant/Core/Cache/ResponseCache.swift`

### Purpose
Singleton in-memory cache with UserDefaults persistence for cold-start recovery. Stores the last 50 chat messages for immediate display before API data loads.

### Findings

#### [MEDIUM] Cache is not scoped by agent
**Lines**: 96-100, 176-181
**Description**: `updateChatMessages()` and `persistChatMessages()` store all messages regardless of agent. `loadPersistedChatMessages()` returns all persisted messages. When the user switches agents, cached messages from the previous agent are loaded, causing a flash of wrong-agent content.
**Impact**: Brief display of wrong agent's messages on cold start or agent switch, until `refresh()` replaces them. Related to the ChatViewModel `loadFromCache()` issue noted above.
**Fix**: Key the cache by agent ID: `UserDefaults.standard.set(data, forKey: "\(Self.chatCacheKey)_\(agentId)")`.

#### [MEDIUM] UserDefaults write on every message
**Lines**: 96-100
**Description**: `updateChatMessages()` is called every time a WebSocket message arrives (from `ChatViewModel.handleIncomingMessage` line 449). Each call triggers `persistChatMessages()` which encodes up to 50 messages as JSON and writes to UserDefaults. UserDefaults writes are serialized to a background queue by the system but involve plist serialization.
**Impact**: In high-throughput scenarios (agent sending many messages quickly, e.g., streaming), this creates significant I/O overhead. UserDefaults is not designed for frequent writes.
**Fix**: Debounce persistence -- persist at most once every N seconds, or persist only on significant events (app backgrounding, WebSocket disconnect).

#### [LOW] In-memory cache grows unbounded
**Lines**: 37, 96-100
**Description**: `chatMessages` is an array that grows with every incoming message. While `persistChatMessages` only saves the last 50, the in-memory array has no eviction policy.
**Impact**: In very long conversations (1000+ messages), memory usage increases. Not a practical concern for most use cases.
**Fix**: Consider capping the in-memory cache at a reasonable limit (e.g., 500 messages).

#### [LOW] No cache invalidation on logout or server change
**Lines**: All
**Description**: If the user changes the server URL (e.g., from production to dev), cached messages from the old server persist and may be displayed briefly.
**Impact**: Confusion during development/testing. Low impact for production users who don't change servers.
**Fix**: Clear the cache when the server URL changes.

### Thread Safety Analysis
Class is `@MainActor` (singleton). All access is from the main thread. **Thread-safe by design.**

### Error Handling Assessment
`try? JSONEncoder().encode(recent)` silently fails if encoding fails (line 178). `try? JSONDecoder().decode(...)` silently fails if decoding fails (line 188). In both cases, the cache simply becomes empty. This is acceptable -- cache is best-effort.

### iOS-Specific Concerns
- UserDefaults has a practical size limit (~1MB before performance degrades). 50 `PersistentMessage` objects serialized to JSON should be well under this limit.
- iOS can evict UserDefaults data under memory pressure, though this is rare.

### Verdict
**MINOR ISSUES** -- Agent scoping is the main concern. Performance of frequent writes is a secondary concern.

---

## File: `ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Messages.swift`

### Purpose
HTTP API methods for message CRUD operations: list, send, search, mark read, unread counts.

### Findings

#### [MEDIUM] `beforeId` cursor with deleted/invalid message ID returns empty results
**Lines**: 16-40
**Description**: `getMessages(beforeId:)` passes the ID to the backend, which uses it in `WHERE (created_at = ? AND id < ?)`. If the message was deleted or the ID is invalid, no rows match the `created_at = ?` condition for that ID, so the query returns nothing even though older messages exist.
**Impact**: Pagination breaks silently -- "Load More" returns empty and `hasMore` becomes false. This matches "Symptom 3: Pagination Broken" in the behavior baseline.
**Fix**: The backend should fall back to timestamp-only pagination when `beforeId` doesn't match a known message. Alternatively, the iOS client should pass both `before` (timestamp) and `beforeId` to enable the backend's composite cursor to work even if the ID is stale.

#### [LOW] No request timeout configuration
**Lines**: All
**Description**: The API methods rely on the `APIClient`'s default timeout configuration. If the server is unreachable but the TCP connection hangs, requests could block for 60+ seconds (iOS URLSession default timeout).
**Impact**: UI appears frozen during network issues until the system timeout fires.
**Fix**: Consider setting a shorter `timeoutIntervalForRequest` (e.g., 15s) on the URLSession configuration.

### Thread Safety Analysis
All methods are `async`, no mutable state. **Thread-safe.**

### Error Handling Assessment
All methods throw on failure, letting callers handle errors. The `requestWithEnvelope` method (from APIClient base) handles HTTP error codes. Clean error propagation.

### iOS-Specific Concerns
- `addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)` in `markMessageRead` (line 66) is correct for URL path encoding.

### Verdict
**MINOR ISSUES** -- The cursor pagination issue with invalid IDs is notable but is a backend-side fix.

---

## File: `ios/AdjutantKit/Sources/AdjutantKit/Models/PersistentMessage.swift`

### Purpose
Data model for persistent messages. Codable, Identifiable, Hashable, Sendable.

### Findings

#### [MEDIUM] `date` computed property creates ISO8601DateFormatter on every access
**Lines**: 65-69
**Description**: `date` creates two `ISO8601DateFormatter` instances on every call -- one with fractional seconds and one without as fallback. `ISO8601DateFormatter` is heavyweight. This property is called in sorting operations (`messages.sort { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }`) which iterate every message.
**Impact**: O(n log n) formatter allocations during each sort. For 500 messages, that's ~4500 formatter allocations per sort. Measurable on older devices.
**Fix**: Use a static shared formatter. Example:
```swift
private static let isoFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()
```

#### [LOW] `Hashable` conformance based on `id` via auto-synthesis
**Lines**: 22
**Description**: `PersistentMessage` conforms to `Hashable`. Swift auto-synthesizes `Hashable` for structs where all stored properties are `Hashable`. This means two messages with different IDs but same content hash differently (correct), but two messages with same ID but different content hash the same (which is ID-based deduplication behavior). This is correct for the use case.
**Impact**: None. This is the desired behavior.
**Fix**: None needed.

### Thread Safety Analysis
Immutable struct, `Sendable`. **Thread-safe by design.**

### Error Handling Assessment
Date parsing fallback (line 68) handles servers that omit fractional seconds. `AnyCodableValue` decoding falls back to `.null` for unknown types. Robust.

### iOS-Specific Concerns
None.

### Verdict
**MINOR ISSUES** -- Date formatter performance is the only concern.

---

## File: `backend/src/services/ws-server.ts`

### Purpose
WebSocket server providing real-time chat, auth handshake, sequence numbering, replay buffer, rate limiting, and session terminal streaming.

### Findings

#### [CRITICAL] `agentId`-only query filtering (cross-cutting with message-store)
**Lines**: 230-256 (handleMessage)
**Description**: When a user sends a message via WebSocket, it's stored with `agentId: "user"` and `recipient: <target>`. When the iOS client later calls `GET /api/messages?agentId=<agent>`, the query only matches `agent_id = <agent>`, missing all user-sent messages. The WebSocket broadcast ensures real-time delivery, but any subsequent HTTP refresh loses user messages.
**Impact**: See ChatViewModel CRITICAL finding above. This is the same root-cause defect viewed from the server side.
**Fix**: Modify `getMessages` in message-store.ts to support conversation-mode filtering: `WHERE agent_id = ? OR recipient = ?`.

#### [HIGH] Session output forwarding listener accumulates without cleanup
**Lines**: 337-355
**Description**: `handleSessionConnect` registers an `onOutput` listener on the bridge connector (line 337). This listener closure captures `client` and `sessionId`. However, there's no corresponding `offOutput` or listener removal when the client disconnects or when `session_disconnect` is received. Each reconnect adds another listener.
**Impact**: Memory leak and duplicate output messages. After N reconnects, each output line is sent N times to the same client. Over time, this degrades performance and causes duplicate terminal output.
**Fix**: `onOutput` should return an unsubscribe function. Store it and call it on disconnect/session_disconnect/client close.

#### [MEDIUM] Replay buffer `shift()` is O(n) for array
**Lines**: 144-155
**Description**: `replayBuffer.shift()` is O(n) for JavaScript arrays since it requires re-indexing all elements. With a 1000-element buffer that's trimmed on every broadcast, this is called frequently.
**Impact**: Minor CPU overhead. At 1000 elements, `shift()` moves ~1000 pointers. Not a practical bottleneck at current scale.
**Fix**: Use a circular buffer or deque for O(1) removal from front. Not urgent.

#### [MEDIUM] `handleMessage` uses synchronous `insertMessage`
**Lines**: 232
**Description**: `messageStore.insertMessage()` is a synchronous SQLite call inside the WebSocket message handler. While `better-sqlite3` is synchronous by design and WAL mode allows concurrent reads, a write lock contention under high load could block the event loop.
**Impact**: Under high message volume, SQLite write contention could delay all WebSocket processing. Unlikely at current scale.
**Fix**: Consider wrapping in a worker thread for high-throughput scenarios. Not urgent.

#### [MEDIUM] Rate limit arrays grow and shift
**Lines**: 157-164
**Description**: `isRateLimited` shifts old timestamps from the front of `messageTimestamps`/`typingTimestamps` arrays. Same O(n) concern as replay buffer, but smaller arrays (max 60/30 elements).
**Impact**: Negligible at current sizes.
**Fix**: No change needed.

#### [LOW] `globalSeq` resets on server restart
**Lines**: 120
**Description**: `globalSeq` starts at 0 on every server restart. Clients that reconnect after a server restart will have `lastSeqSeen > 0` but the server's `lastSeq` in the `connected` message will be 0. The sync condition `lastSeqSeen > 0 && lastSeqSeen < lastSeq` (client-side) evaluates to `false` since `lastSeqSeen > lastSeq`, so no sync is requested.
**Impact**: Messages sent between the old server's last broadcast and the new server's start are silently lost. The client doesn't know to do a full HTTP refresh.
**Fix**: Persist `globalSeq` to disk, or include a server instance ID in the `connected` message so clients can detect server restarts and do a full refresh.

### Thread Safety Analysis
Node.js single-threaded event loop. All WebSocket handlers run synchronously (except session handlers which use `async/await` but are still single-threaded). The `clients` Map and `replayBuffer` are accessed only from the event loop. **Thread-safe by design.**

### Error Handling Assessment
- `handleMessage`: If `messageStore` is null, an error is sent to the client (line 220-228). Good.
- `handleSessionConnect/Disconnect/Input/Interrupt`: All wrapped in try/catch with error messages sent to client. Good.
- Dynamic `import("./session-bridge.js")` failures are caught and ignored (e.g., line 269). Acceptable.
- `JSON.parse` failures in message handling send a parse error to client (line 532). Good.

### iOS-Specific Concerns
N/A (backend file).

### Verdict
**CRITICAL ISSUES** -- The agentId filtering is the same root-cause defect. Session output listener leak is HIGH severity.

---

## File: `backend/src/services/message-store.ts`

### Purpose
SQLite message persistence layer with cursor-based pagination, full-text search, and unread counts.

### Findings

#### [CRITICAL] `getMessages` with `agentId` filter only matches sender, not recipient
**Lines**: 176-179
**Description**: `conditions.push("agent_id = ?")` only filters by the message sender column. For a user-agent conversation, this returns only one direction of messages. See ChatViewModel CRITICAL finding for full impact.
**Impact**: Root cause of message loss on refresh. All callers (iOS, web, MCP) are affected.
**Fix**: Add a `conversationWith` option that filters `WHERE (agent_id = ? OR recipient = ?)`:
```typescript
if (opts.conversationWith !== undefined) {
  conditions.push("(agent_id = ? OR recipient = ?)");
  params.push(opts.conversationWith, opts.conversationWith);
}
```

#### [CRITICAL] `beforeId` pagination without `before` timestamp ignores the cursor
**Lines**: 197-206
**Description**: The composite cursor pagination requires BOTH `before` (timestamp) and `beforeId` (ID). But the iOS client only sends `beforeId` (see `ChatViewModel.loadMoreHistory()` line 375 and `APIClient+Messages.swift` line 29). Without `before`, the `beforeId` is simply ignored -- the `opts.before` check at line 197 fails, and no pagination condition is added. The query returns the most recent messages again instead of older ones.
**Impact**: Pagination is effectively broken when the caller sends `beforeId` without `before`. The iOS client's `loadMoreHistory()` sends `beforeId` alone, causing "Load More" to return the same messages repeatedly. This directly matches "Symptom 3: Pagination Broken."
**Fix**: Either:
1. The backend should look up the message's `created_at` when only `beforeId` is provided:
```typescript
if (opts.beforeId !== undefined && opts.before === undefined) {
  const ref = getByIdStmt.get(opts.beforeId) as MessageRow | undefined;
  if (ref) opts.before = ref.created_at;
}
```
2. Or the iOS client should send both `before` and `beforeId`.

#### [MEDIUM] `unreadCounts` returns counts for ALL agent_id values including "user"
**Lines**: 140-144
**Description**: The unread counts query is `WHERE delivery_status != 'read' GROUP BY agent_id`. This counts unread messages per SENDER. User-sent messages (agent_id = "user") with `delivery_status = "pending"` are counted as "unread from user", which doesn't make sense from the user's perspective.
**Impact**: The unread badge may show inflated counts because user's own pending messages are counted. The frontend filters by agentId, so the "user" entry may not be displayed, but it's returned unnecessarily.
**Fix**: Filter out user messages: `WHERE delivery_status != 'read' AND role = 'agent'` or `AND agent_id != 'user'`.

#### [MEDIUM] `getThreads` correlated subquery is not deterministic across agents
**Lines**: 278-292
**Description**: The `getThreads` query groups by `thread_id` but uses a non-aggregated `agent_id` in the SELECT. In SQLite, this returns an arbitrary `agent_id` from the group. For threads with messages from multiple agents, the returned `agent_id` is unpredictable.
**Impact**: Thread listings may show the wrong agent for mixed-agent threads. Currently low impact since threads are typically two-party.
**Fix**: Use `MAX(agent_id)` or a subquery to get the most recent message's agent_id.

#### [LOW] No index on composite cursor columns
**Lines**: N/A (schema in 001-initial.sql)
**Description**: The pagination query uses `WHERE (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC`. The existing index `idx_messages_agent` is `(agent_id, created_at)`, which helps with the agent filter + timestamp, but the `OR (created_at = ? AND id < ?)` clause may not use the index efficiently.
**Impact**: Pagination queries may be slower than necessary for large message tables. Not a practical concern at current scale.
**Fix**: Consider a composite index `(agent_id, created_at, id)` for optimal pagination performance.

### Thread Safety Analysis
Synchronous SQLite with `better-sqlite3`. WAL mode enabled in database.ts. Multiple readers are allowed concurrently. Only one writer at a time (enforced by SQLite's internal lock with `busy_timeout = 5000`). Since Node.js is single-threaded, concurrent writes within the same process are serialized by the event loop. **Thread-safe.**

### Error Handling Assessment
- `insertMessage`: No error handling -- will throw if SQLite constraint fails (e.g., duplicate ID from `randomUUID`, astronomically unlikely).
- `searchMessages`: Sanitizes FTS5 input by wrapping in double quotes and escaping internal quotes (line 242). **Good SQL injection prevention.**
- `getMessages`: Builds queries with parameterized placeholders. **No SQL injection risk.**

### iOS-Specific Concerns
N/A (backend file).

### Verdict
**CRITICAL ISSUES** -- Two critical findings: the agentId-only filtering and the broken beforeId-without-before pagination. Both are root causes of user-reported symptoms.

---

## File: `backend/src/routes/messages.ts`

### Purpose
REST endpoints for message CRUD: list, get, unread counts, threads, mark-read, send.

### Findings

#### [HIGH] GET `/api/messages` uses `agentId` for sender-only filtering
**Lines**: 67-87
**Description**: The route passes `agentId` directly to `store.getMessages({ agentId })`, which only filters by `agent_id` (sender). For conversation views, the frontend needs BOTH directions. This is the route-level manifestation of the CRITICAL message-store defect.
**Impact**: See message-store CRITICAL finding.
**Fix**: Either add a separate `conversationWith` query param that maps to the new store option, or change `agentId` semantics to mean "conversation with this agent" at the route level.

#### [MEDIUM] `limit` not validated for sanity bounds
**Lines**: 72-73
**Description**: `limitStr` is parsed with `parseInt` but not bounds-checked. A client could send `limit=999999` or `limit=-1` or `limit=NaN`.
**Impact**: `limit=999999` could return a massive result set, causing high memory usage and slow response. `limit=NaN` results in `undefined`, which means no limit (returns all messages). `limit=-1` is passed to SQLite's `LIMIT -1` which returns all rows.
**Fix**: Clamp limit to a reasonable range: `const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 200) : undefined;`

#### [MEDIUM] POST `/api/messages` doesn't validate message length
**Lines**: 115-163
**Description**: The Zod schema validates `body: z.string().min(1)` but has no max length. A client could send a multi-megabyte message body, which would be stored in SQLite and broadcast to all WebSocket clients.
**Impact**: Potential DoS via oversized messages. Also degrades WebSocket performance for all connected clients.
**Fix**: Add `z.string().min(1).max(10000)` or similar reasonable limit.

#### [LOW] `hasMore` heuristic is inexact
**Lines**: 85
**Description**: `hasMore: limit !== undefined && messages.length === limit`. This is a common heuristic but can be wrong: if exactly `limit` messages exist, `hasMore` is `true` when it should be `false`. The next page request returns 0 results.
**Impact**: One extra empty page request at the end of pagination. Minor UX issue.
**Fix**: Query `limit + 1` rows, return `limit` rows, and set `hasMore = fetchedCount > limit`. Common pattern.

### Thread Safety Analysis
Express request handlers are synchronous (no `async`). SQLite calls are synchronous. No shared mutable state across requests. **Thread-safe.**

### Error Handling Assessment
- Input validation via Zod schema with clear error messages. Good.
- `store.getMessage(id!)` for GET `/:id` -- the `!` is safe because Express guarantees `req.params.id` exists for this route pattern.
- Session bridge access wrapped in try/catch (lines 150-161). Good.

### iOS-Specific Concerns
N/A (backend file).

### Verdict
**NEEDS ATTENTION** -- The agentId filtering issue propagates from the store. Input validation gaps (limit, body length) should be addressed.

---

## File: `backend/src/services/mcp-tools/messaging.ts`

### Purpose
MCP tool handlers for agent messaging: send_message, read_messages, list_threads, mark_read.

### Findings

#### [MEDIUM] `read_messages` has same `agentId` filtering limitation
**Lines**: 100-128
**Description**: `read_messages` tool passes `agentId` to `store.getMessages`, which only filters by sender. Agents reading their own conversation with the user would not see user-sent messages.
**Impact**: Agents don't see the full conversation history when using `read_messages` with `agentId` filter. This affects agent behavior since they lack context of what the user said.
**Fix**: Same as the store-level fix -- add conversation-mode filtering.

#### [LOW] APNS error handling is fire-and-forget
**Lines**: 66-79
**Description**: `sendNotificationToAll()` errors are caught and logged but not reported back to the agent. The agent's message is still stored and broadcast successfully.
**Impact**: If APNS delivery fails, the agent and user are unaware. The user may not get a push notification. Acceptable since the message is still delivered via WebSocket/polling.
**Fix**: No change needed -- push notifications are best-effort.

### Thread Safety Analysis
MCP tool handlers are async. No shared mutable state. MessageStore access is serialized by Node.js event loop. **Thread-safe.**

### Error Handling Assessment
- Session validation: returns error if `agentId` is undefined (unknown session). Good.
- Store errors would propagate as unhandled exceptions. The MCP SDK likely catches these and returns an error to the client.
- Zod validation on tool inputs. Good.

### iOS-Specific Concerns
N/A (backend file).

### Verdict
**MINOR ISSUES** -- Same agentId filtering issue as the rest of the pipeline.

---

## Cross-Cutting Protocol Contracts (adj-012.3.5)

### Auth Handshake Protocol

**Contract**: Server sends `auth_challenge` -> Client sends `auth_response` with `apiKey` -> Server sends `connected` with `sessionId`, `lastSeq`, `serverTime` or `error` with `code: "auth_failed"`.

**Finding [MEDIUM]**: No client-side timeout for the `connected` response after sending `auth_response`. The server has a 10s timeout (`AUTH_TIMEOUT_MS`), but the client waits indefinitely. If the `connected` message is dropped (network issue), the client is stuck in `.authenticating` until the server closes the connection.

**Finding [LOW]**: The iOS client sends `apiKey: apiKey ?? ""` (empty string) when no API key is configured. The server in open mode (`!hasApiKeys()`) ignores the key entirely, so this is correct but semantically odd.

### Sequence Numbering Invariants

**Contract**: Server assigns monotonic `seq` to broadcast messages. Client tracks `lastSeqSeen`. On reconnect, client sends `sync` with `lastSeqSeen`, server responds with missed messages.

**Finding [HIGH]**: `lastSeqSeen` is only updated in the `default` case of `handleRawMessage` (WebSocketClient.swift line 514-518). Messages handled in specific cases (`chat_message`, `typing`, `delivered`, etc. via `messageSubject.send()` -> ChatWebSocketService) DON'T update `lastSeqSeen`. Since most chat messages arrive as `chat_message` type, `lastSeqSeen` barely advances. On reconnect, the sync request asks for messages since seq=0 (or whatever the last `default`-case message was), potentially replaying hundreds of already-delivered messages.

**Impact**: Wasteful replay on reconnect, potential duplicate messages in the UI (though ChatViewModel deduplicates by ID). If the replay buffer has been trimmed, messages between the stale `lastSeqSeen` and the actual last-seen message are requested but unavailable -- leading to a gap that's invisible to the client.

**Fix**: Update `lastSeqSeen` for ALL messages with a `seq` field, not just those in the `default` case. Move the seq update to the top of `handleRawMessage`:
```swift
if let seq = msg.seq {
    lastSeqSeen = max(lastSeqSeen, seq)
}
```

### Cursor Pagination Contract

**Contract**: Client sends `beforeId` (and optionally `before`) to paginate. Server returns messages older than the cursor.

**Finding [CRITICAL]**: (Already documented above) The iOS client sends `beforeId` without `before`. The backend requires BOTH for the composite cursor to work. With `beforeId` alone, no pagination condition is applied -- the query returns the newest messages again.

**Finding [MEDIUM]**: If the `beforeId` message was deleted, the `before` timestamp lookup fails, and the composite cursor degrades to timestamp-only (which can return the same messages again if there are ties at that second).

### Optimistic UI Protocol

**Contract**: Client sends `message` with `id` (used as clientId). Server stores, assigns server `id`, sends `delivered` with both `messageId` (server) and `clientId`. Client replaces local message.

**Finding [MEDIUM]**: The iOS client uses `"local-\(clientId)"` as the optimistic message ID, while the web frontend uses `"optimistic-\(clientId)"`. This is a cosmetic difference, but both rely on the `delivered` event's `clientId` field to match. If the `delivered` event is lost (e.g., during disconnect), the optimistic message is never confirmed and persists as "pending" forever.

**Fix**: On refresh, use body-matching as a fallback (already implemented in `isConfirmedMessage`). The existing implementation is acceptable but fragile (see finding about body-matching above).

### Message Type Unions

**Client (iOS) WsServerMessage types**: `auth_challenge`, `connected`, `sync_response`, `error`, `session_connected`, `session_disconnected`, `session_output`, `session_raw`, `session_status`, `session_ended`, plus `default` for others.

**Server WsServerMessage types**: `auth_challenge`, `connected`, `message`, `chat_message`, `stream_token`, `stream_end`, `typing`, `delivered`, `error`, `sync_response`, `pong`, `session_connected`, `session_disconnected`, `session_output`, `session_raw`, `session_status`.

**Finding [LOW]**: The client handles `session_ended` (line 509) but the server never sends `session_ended` -- it only sends `session_disconnected`. These are mapped to the same handler on the client side, so there's no practical impact. However, the `session_ended` handler is dead code.

**Finding [LOW]**: The server can send `type: "message"` (line 51) but no handler in the client matches this type. It falls through to the `default` case in `handleRawMessage`, where it's forwarded to `messageSubject`. `ChatWebSocketService.handleServerMessage` doesn't handle `"message"` type, so it falls through to the `default: break` case and is silently dropped. Whether the server actually sends `"message"` type depends on other code paths not reviewed here.

---

## Summary of Findings by Severity

### CRITICAL (4)
1. **User messages lost on refresh** -- `getMessages(agentId)` only filters by sender, missing user-to-agent messages. Root cause of "messages lost after backgrounding" symptom. (message-store.ts:176, ws-server.ts:230, messages.ts:67, ChatViewModel.swift:279)
2. **Pagination broken with `beforeId` alone** -- iOS sends `beforeId` without `before`, backend ignores it, returning newest messages. Root cause of "pagination broken" symptom. (message-store.ts:197, ChatViewModel.swift:375, APIClient+Messages.swift:29)
3. **Sequence tracking stale** -- `lastSeqSeen` not updated for most message types, causing wasteful/incomplete replay on reconnect. (WebSocketClient.swift:514-518)
4. **Session output listener leak** -- `onOutput` listener registered on every session connect, never removed. Causes duplicate output and memory leak. (ws-server.ts:337-355)

### HIGH (6)
1. **WebSocketClient thread safety** -- `@unchecked Sendable` with mutable state accessed from multiple threads. (WebSocketClient.swift:237)
2. **Refresh race condition** -- Two concurrent `refresh()` calls from `onAppear` and WebSocket `connected` callback. (ChatViewModel.swift:217-228, 246-272)
3. **`hasMoreHistory` not reset on recipient switch** -- Stale pagination flag prevents loading history for new agent. (ChatViewModel.swift:349-363)
4. **Sequence gap recovery unreliable** -- No detection of replay buffer exhaustion, no fallback to HTTP refresh. (WebSocketClient.swift:450-452)
5. **GET `/api/messages` uses sender-only filtering** -- Route-level propagation of the CRITICAL store defect. (messages.ts:67-87)
6. **`lastSeqSeen` update only in default case** -- Most chat messages don't update the sequence tracker. (WebSocketClient.swift:514-518, cross-cutting)

### MEDIUM (9)
1. **Cache not scoped by agent** -- Wrong-agent messages shown on cold start. (ResponseCache.swift:96-100)
2. **UserDefaults write on every message** -- Performance concern for high-throughput scenarios. (ResponseCache.swift:96-100)
3. **Incoming chat_message hardcoded as `role: .agent`** -- Multi-device user messages mis-attributed. (ChatWebSocketService.swift:132-149)
4. **`isConfirmedMessage` body-matching fragile** -- Identical rapid messages can cross-match. (ChatViewModel.swift:318-320)
5. **No client-side auth response timeout** -- Client stuck in `.authenticating` if server response lost. (WebSocketClient.swift:440-444)
6. **After max reconnect attempts, no recovery** -- WebSocket permanently gives up. (WebSocketClient.swift:546-549)
7. **`limit` not validated** -- Potential DoS via `limit=999999`. (messages.ts:72-73)
8. **POST message body not length-limited** -- Potential DoS via oversized messages. (messages.ts:115-163)
9. **ISO8601DateFormatter created per access** -- Performance concern in sort operations. (PersistentMessage.swift:65-69)

### LOW (4)
1. **`globalSeq` resets on server restart** -- Messages lost across server restart gap. (ws-server.ts:120)
2. **`send()` silently drops messages** -- No caller notification of send failure. (WebSocketClient.swift:524-528)
3. **Force-unwrap in URL construction** -- Crash risk with malformed base URL. (WebSocketClient.swift:407)
4. **Dead code for `session_ended` type** -- Handler exists but server never sends this type. (WebSocketClient.swift:509)

---

## Recommended Fix Priority

### Immediate (blocks correct behavior)
1. Fix `getMessages` to filter by conversation (both `agent_id` and `recipient`)
2. Fix `beforeId`-only pagination to resolve the cursor before querying
3. Move `lastSeqSeen` update to top of `handleRawMessage` for all sequenced messages

### Short-term (reliability improvements)
4. Fix session output listener leak in ws-server.ts
5. Address WebSocketClient thread safety (`@MainActor` or serial queue)
6. Add `hasMoreHistory = true` reset in `setRecipient()`
7. Guard `refresh()` against concurrent execution
8. Add input validation bounds for `limit` and message body length

### Medium-term (quality of life)
9. Scope cache by agent ID
10. Add reconnection after max attempts (on network change)
11. Debounce UserDefaults persistence
12. Static ISO8601DateFormatter instances
13. Add client-side auth timeout
