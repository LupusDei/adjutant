# Session Pipeline Audit Report (adj-008)

Date: 2026-02-20
Auditor: Claude Opus 4.6
Scope: Full session pipeline from tmux to iOS client

---

## 1. Architecture Diagram

```
iOS Client (WebSocket)
     |
     v
[ws-server.ts]  <-- WS message router
     |                   |
     |  session_connect  |  session_input / interrupt / permission
     |                   |
     v                   v
[session-bridge.ts]  <-- Orchestrator singleton
     |         |         |
     |         |         +-----> [input-router.ts] --> tmux send-keys
     |         |
     |         +-------> [session-connector.ts]
     |                        |
     |    capture-pane poll   |  (every 1.5s)
     |    (tmux capture-pane) |
     |                        v
     |                   [output-parser.ts]
     |                        |
     |                   OutputEvent[]
     |                        |
     v                        v
[session-registry.ts]    OutputHandler callbacks
     |                        |
     |                   [event-bus.ts]
     |                        |
     v                        v
  sessions.json           SSE / WS broadcast
  (persistence)           to all clients

[lifecycle-manager.ts]
     |
     +-- createSession: tmux new-session + send-keys "claude ..."
     +-- killSession: tmux kill-session
     +-- isAlive: tmux has-session + list-panes (auto-heal)
     +-- discoverSessions: tmux list-sessions
```

### Data Flow Summary

1. **Session creation**: `lifecycle-manager` creates a tmux session, runs `claude` in it
2. **Client connect**: WS client sends `session_connect`, `session-bridge` registers the client and starts capture-pane polling via `session-connector`
3. **Output capture**: Every 1.5s, `session-connector` runs `tmux capture-pane -p -S -500`, diffs against last snapshot, parses new lines via `output-parser`, emits events
4. **Event delivery**: Events flow through `OutputHandler` callbacks to both the `event-bus` (for SSE) and per-client WS handlers (in `ws-server`)
5. **Input routing**: WS client sends `session_input`, routed through `input-router` to `tmux send-keys`
6. **Disconnection**: WS close triggers cleanup of client registrations and pipe detach when no clients remain

---

## 2. Issues Found

### CRITICAL-1: Output Handler Leak Causing Message Duplication (FIXED)

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/ws-server.ts`
**Lines**: 321-340 (handleSessionConnect)

**Problem**: Every call to `handleSessionConnect` registers a new `OutputHandler` on the `SessionConnector` via `bridge.connector.onOutput(...)`, but the handler is **never removed**. The handler array grows without bound:

- When a WS client connects to session A, handler #1 is added
- Client disconnects and reconnects: handler #2 is added (handler #1 is still there)
- Each reconnection adds another handler
- All handlers fire on every poll, causing **duplicate messages** to the client
- Multiple clients connecting to the same session each get ALL events (not just their session's) -- filtered in the closure, but the closure itself leaks

Additionally, on WS close, the cleanup code called `disconnectClient()` but never called `connector.offOutput()` to remove the handler closure.

**Impact**: This is the root cause of the reported message duplication bug. Over time, handler count grows unbounded, causing increasing CPU waste and duplicate WS messages.

**Fix applied**:
- Added `sessionOutputHandlers: Map<string, OutputHandler>` to the `WsClient` interface to track handlers per session
- On `session_connect`, remove any previous handler for that session before registering a new one
- On `session_disconnect`, remove the handler before disconnecting
- On WS close, iterate all tracked handlers and call `offOutput()` before cleanup
- Added `readyState === WebSocket.OPEN` guard to prevent sending to closed sockets

---

### CRITICAL-2: Vestigial pipe-pane Creating Unread Files (FIXED)

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/session-connector.ts`
**Lines**: 128-143 (attach method)

**Problem**: The `attach()` method still ran `tmux pipe-pane -o -t <pane> 'cat >> <file>'` even though the adj-007 fix switched entirely to `capture-pane` polling. This meant:

1. A pipe file was created and continuously written to by tmux but **never read**
2. The pipe file grew unbounded until session detach (disk leak)
3. The `pipe-pane` command itself could interfere with pane output
4. If the pipe file path contained spaces or special characters, the `cat >>` shell command could fail, causing `attach()` to fail entirely (ENOENT source)

**Fix applied**:
- Removed `pipe-pane` invocation from `attach()` entirely
- Replaced with a `display-message` check to verify the pane exists before starting polling
- Removed `writeFileSync` for the pipe file creation
- Updated `detach()` to not call `pipe-pane` to stop (since it's never started)
- Kept legacy pipe file cleanup in `detach()` for files from prior runs

---

### HIGH-1: Race Condition in Initial Capture Snapshot

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/session-connector.ts`
**Lines**: 273-319 (startCapturePoll)

**Problem**: The initial `capture-pane` snapshot was fire-and-forget (`.then().catch()`) while the `setInterval` poll started immediately. If the first interval fires before the initial snapshot Promise resolves, `lastCaptureLines` is still `[]`, causing the diff algorithm to treat the ENTIRE pane content as new, emitting a burst of duplicate events for everything visible on screen.

**Fix applied**: Added an `initialSnapshotDone` flag. The interval callback returns early if the flag is false, preventing polling until the baseline is established.

---

### HIGH-2: diffAndParse Suffix-Matching Has O(n*m) Worst Case

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/session-connector.ts`
**Lines**: 331-370 (diffAndParse)

**Problem**: The suffix-matching algorithm iterates from `maxOverlap` down to 1, doing a string comparison for each `tryLen`. In the worst case (no overlap found), this is O(n*m) where n = old content length and m = new content length. With `-S -500` (500 lines of scrollback), the conversation extract could be hundreds of lines, making this potentially slow.

More concerning edge cases:
- **Identical consecutive messages**: If Claude outputs "Done." twice in a row, the overlap detector could match the wrong position, either skipping or duplicating content
- **Pane cleared or reset**: If the pane is cleared (e.g., `clear` command or Claude Code TUI reset), `newContent` will be empty or completely different. The algorithm handles this correctly (overlapLen=0, all new content emitted), but the full old content was already emitted -- so no duplication. This case is fine.
- **Claude Code TUI re-renders**: When the TUI redraws (e.g., spinner update, resize), the `extractConversation` filter should strip TUI chrome. However, if a partial re-render changes indentation of conversation lines, the diff could re-emit already-seen content.

**Severity**: High (performance) / Medium (correctness for edge cases)

**Recommendation**: Consider using a hash-based approach or tracking a monotonic cursor:
```typescript
// Option A: Hash the last N lines as a fingerprint
const fingerprint = hashLines(oldContent.slice(-20));
// Find where this fingerprint appears in newContent
const idx = findFingerprint(newContent, fingerprint);
const added = idx >= 0 ? newContent.slice(idx + 20) : newContent;

// Option B: Track the tmux pane's history_size as a cursor
// tmux display-message -t pane -p '#{history_size}'
// Only process content beyond the cursor position
```

---

### HIGH-3: Concurrent attach() Calls for Same Session

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/session-connector.ts`

**Problem**: The `attach()` method checks `this.pipes.has(sessionId)` at the top and returns if already attached. However, if two `connectClient()` calls arrive nearly simultaneously (e.g., iOS app reconnecting while the bridge retry loop is running), both can pass the `has()` check before either sets the pipe state. This would start two polling intervals for the same session.

**Recommendation**: Add a `Set<string>` of "attaching" session IDs as a mutex:
```typescript
private attaching = new Set<string>();

async attach(sessionId: string): Promise<boolean> {
  if (this.attaching.has(sessionId)) return true; // Already in progress
  this.attaching.add(sessionId);
  try {
    // ... existing logic ...
  } finally {
    this.attaching.delete(sessionId);
  }
}
```

---

### HIGH-4: Session Bridge Output Handler Also Leaks (EventBus Path)

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/session-bridge.ts`
**Lines**: 133-146 (_init method)

**Problem**: During `_init()`, a single output handler is registered on the connector for broadcasting via EventBus. This handler is never removed on `shutdown()`. If the bridge is shut down and re-initialized (e.g., during testing or hot reload), the old handler remains, causing duplicate EventBus emissions.

The `shutdown()` method calls `connector.detachAll()` (which clears pipes) but does not call `connector.offOutput()` for the bridge's own handler.

**Recommendation**: Store the handler reference and remove it during shutdown:
```typescript
private bridgeOutputHandler: OutputHandler | null = null;

async _init() {
  this.bridgeOutputHandler = (sessionId, _line, events) => { ... };
  this.connector.onOutput(this.bridgeOutputHandler);
}

async shutdown() {
  if (this.bridgeOutputHandler) {
    this.connector.offOutput(this.bridgeOutputHandler);
    this.bridgeOutputHandler = null;
  }
  // ... rest of shutdown ...
}
```

---

### MEDIUM-1: Input Queue Flushing Delivers All Queued Messages Instantly

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/input-router.ts`
**Lines**: 119-140 (flushQueue)

**Problem**: When `flushQueue()` is called (triggered when a session transitions to "idle"), it delivers ALL queued messages to the tmux pane in a tight loop with no delay between them. If multiple messages were queued while Claude was working, they all hit the pane as rapid `send-keys` calls. Claude Code may not process them correctly -- it expects one input at a time.

**Recommendation**: Only deliver the first queued message, and let the next status transition to "idle" deliver the next one. Or add a short delay between sends:
```typescript
async flushQueue(sessionId: string): Promise<number> {
  const queue = this.queues.get(sessionId);
  if (!queue || queue.length === 0) return 0;

  // Only deliver the first queued item
  const item = queue.shift()!;
  const ok = await this.deliverInput(session.tmuxPane, item.text);

  if (queue.length === 0) this.queues.delete(sessionId);
  return ok ? 1 : 0;
}
```

---

### MEDIUM-2: Multi-line Input Not Handled by send-keys

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/input-router.ts`
**Lines**: 177-192 (deliverInput)

**Problem**: The `deliverInput` method strips trailing newlines and sends the text with `-l` (literal) flag followed by `Enter`. However, if the input contains embedded newlines (multi-line paste), the `-l` flag sends the literal `\n` characters, which tmux interprets differently than pressing Enter. The embedded newlines become part of the input text rather than line breaks.

For Claude Code's input, this is mostly fine since it reads a single prompt. But for multi-line code pastes or structured input, the behavior may be unexpected.

**Recommendation**: Split on newlines and send each line separately:
```typescript
private async deliverInput(tmuxPane: string, text: string): Promise<boolean> {
  const lines = text.replace(/\n+$/, "").split("\n");
  for (const line of lines) {
    await execTmuxCommand(["send-keys", "-t", tmuxPane, "-l", line]);
    await execTmuxCommand(["send-keys", "-t", tmuxPane, "Enter"]);
  }
  return true;
}
```

---

### MEDIUM-3: capture-pane -S -500 Buffer Limit

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/session-connector.ts`

**Problem**: The `capture-pane -S -500` flag captures the last 500 lines of scrollback. If Claude's output exceeds 500 lines between two polls (1.5s interval), lines will scroll past the buffer and be lost. Additionally, as the session runs longer, the conversation area may shift entirely within the 500-line window, causing the diff algorithm to see no overlap and re-emit old content that was already sent.

This is mitigated by `extractConversation()` which filters to only conversation markers, but it's still possible to lose content during rapid output.

**Recommendation**: Increase to `-S -1000` or use `-S -` (full history). Monitor performance impact since full history could be large. Alternatively, track the tmux history position and use `-S <position>` to get exactly the new content.

---

### MEDIUM-4: extractConversation Regex May Miss Content

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/session-connector.ts`
**Lines**: 383-411 (extractConversation)

**Problem**: The conversation extractor relies on specific Unicode markers:
- `\u276f` (Heavy Right-Pointing Angle Quotation Mark) for user input
- `\u23fa` (Black Circle for Record) for agent messages
- Indented continuation lines (2+ spaces)

If Claude Code changes its TUI characters (version update), or if the tmux session is configured with different encoding, these markers won't match and all content will be filtered out. The `CHROME` regex is also fragile -- it's pattern-matching specific TUI elements that could change.

Additionally, `inConversation` is set to `false` when a non-matching line is encountered. This means a single unexpected line (e.g., a tmux status bar leak, a notification) in the middle of agent output would cause subsequent indented lines to be skipped.

**Recommendation**: Make the extraction more robust by tracking conversation blocks by their separator/marker structure rather than individual line patterns. Consider a fallback that includes all non-chrome content.

---

### MEDIUM-5: Registry Persistence Race

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/session-registry.ts`
**Lines**: 225-243 (save)

**Problem**: `save()` is called from multiple places without coordination:
- `_init()` after verification
- `createSession()`
- `connectClient()` on pipe failure recovery
- `killSession()`

If two async operations trigger `save()` concurrently, the writes race. `writeFile()` is not atomic -- a crash during write could corrupt the file. The `load()` method has no validation beyond JSON parsing.

**Recommendation**:
1. Use atomic write (write to temp file, then rename)
2. Debounce saves with a short delay (e.g., 500ms)
3. Add a version/checksum to detect corruption

---

### MEDIUM-6: EventBus Listener Leak Potential

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/event-bus.ts`

**Problem**: The EventBus sets `maxListeners(100)`. Each SSE client adds a wildcard listener via `onAny()`. Each WS client's session connection adds an output handler. If there are many concurrent clients or rapid reconnections, the listener count could approach 100, and EventEmitter would start warning about potential leaks.

The SSE cleanup in `events.ts` properly removes listeners on disconnect. But the WS handler leak (CRITICAL-1, now fixed) could have been pushing toward this limit.

**Recommendation**: Monitor listener counts. Consider a fan-out pattern where a single EventBus listener dispatches to a client registry, rather than one listener per client.

---

### MEDIUM-7: No Heartbeat/Liveness Check for Capture-Pane Polling

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/session-connector.ts`

**Problem**: The capture-pane poll silently swallows errors in its catch block. If a tmux session dies, the poll just keeps running and failing every 1.5s forever. There's no mechanism to detect a dead session and clean up.

The `session-bridge` relies on explicit `isAlive()` checks, but these are only triggered during `connectClient()`. A session that dies while a client is connected will have its polling timer leak until the WS client disconnects.

**Recommendation**: Count consecutive capture failures. After N failures (e.g., 5), auto-detach and mark the session offline:
```typescript
let consecutiveFailures = 0;
try {
  const output = await execTmuxCommand([...]);
  consecutiveFailures = 0;
  // ... process ...
} catch {
  consecutiveFailures++;
  if (consecutiveFailures >= 5) {
    this.registry.updateStatus(pipe.sessionId, "offline");
    await this.detach(pipe.sessionId);
  }
}
```

---

### LOW-1: Permission Counter Not Session-Scoped

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/output-parser.ts`
**Line**: 137 (permCounter)

**Problem**: `permCounter` is an instance variable that increments globally across all sessions. If a parser is used for multiple sessions (which doesn't happen in practice since each session gets its own parser), permission IDs could collide. The `reset()` method does not reset the counter, so a parser that's reset and reused (as in `diffAndParse`) will continue incrementing.

**Impact**: Low -- permission IDs are only locally significant and the counter gap doesn't cause bugs.

---

### LOW-2: OutputParser reset() Called on Every diffAndParse

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/session-connector.ts`
**Line**: 362

**Problem**: `diffAndParse` calls `parser.reset()` before processing new lines. This means the parser's internal state (current mode, accumulated message lines, tool result) from the previous poll is always discarded. If a message spans two poll intervals (1.5s), the first half will be emitted as one event and the second half as another.

This is actually a reasonable design choice for polling-based capture (each poll is a complete snapshot diff), but it means long messages will be fragmented into multiple events. Not a bug per se, but worth noting.

---

### LOW-3: pipeTrace Uses Synchronous appendFileSync

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/session-connector.ts`
**Lines**: 26-35

**Problem**: `pipeTrace()` calls `appendFileSync()` on every trace call. Synchronous file I/O blocks the event loop. During busy polling, this could cause latency spikes.

**Recommendation**: Switch to async `appendFile()` or use a buffered logger that flushes periodically.

---

### LOW-4: WS Close Handler Uses Dynamic Import

**File**: `/Users/Reason/code/ai/adjutant/backend/src/services/ws-server.ts`
**Lines**: 594-604 (ws close handler)

**Problem**: The WS close handler uses `import("./session-bridge.js")` dynamically. This is presumably to avoid circular dependency, but it means the cleanup is async and unhandled errors in the `.then()` chain are silently swallowed. If the import fails or the bridge throws, the client's session connections may not be cleaned up.

**Recommendation**: Import the bridge module at the top level if possible, or at least log errors from the catch block.

---

### LOW-5: Session Create Schema Allows Empty claudeArgs

**File**: `/Users/Reason/code/ai/adjutant/backend/src/routes/sessions.ts`
**Line**: 104

**Problem**: When `claudeArgs` is provided as an empty array `[]`, the session is created with `claude` (no arguments). The default in `lifecycle-manager.ts` is `["--dangerously-skip-permissions"]`. So explicitly passing `[]` would launch Claude Code without the skip-permissions flag, which would cause it to prompt for permissions that the pipeline may not handle correctly.

**Recommendation**: Document this behavior or use a default-merge strategy:
```typescript
const claudeArgs = data.claudeArgs?.length ? data.claudeArgs : undefined;
```

---

## 3. Session Lifecycle Scenarios

### Backend Restart While Sessions Are Active

1. Sessions are persisted to `~/.adjutant/sessions.json` via `registry.save()`
2. On restart, `_init()` loads persisted sessions and checks `isAlive()` for each
3. Dead sessions are pruned; alive sessions are set to "idle"
4. Clients must reconnect (WS connections are lost on restart)
5. **Gap**: Output that occurred during restart is lost (not captured by polling)
6. **Gap**: The `pipeActive` flag is persisted as `true` but no pipe is actually running after restart. This is cosmetic since `pipeActive` is reset during `connectClient()`.

### tmux Session Dies While Client Is Connected

1. Capture-pane poll fails silently (catch block swallows error)
2. Poll timer continues running, wasting resources (see MEDIUM-7)
3. Client sees no new output but receives no error notification
4. Only when client explicitly calls an action (input, interrupt) will a failure be visible
5. **Fix needed**: Dead session detection in polling loop

### Multiple iOS Clients on Same Session

1. Both clients call `session_connect`
2. Both are added to `connectedClients` Set (no conflict)
3. Both register separate output handlers (fixed in CRITICAL-1)
4. Both receive the same events (expected behavior)
5. Both can send input (potential conflict -- last writer wins in tmux)
6. When one disconnects, pipe stays active (other client still connected)
7. When both disconnect, pipe detaches
8. **Issue**: No coordination of input between multiple clients. Two clients sending input simultaneously could interleave characters.

### Session Killed While Pipe Being Read

1. `killSession()` calls `connector.detach()` first, then `lifecycle.killSession()`
2. `detach()` sets `pipe.active = false`, clears the interval timer, removes from maps
3. Any in-flight capture-pane command will fail (pane gone), but the catch block handles this
4. The parser is flushed before cleanup, so any pending events are emitted
5. **This scenario is handled correctly.**

---

## 4. Summary of Fixes Applied

| Issue | Severity | Status |
|-------|----------|--------|
| CRITICAL-1: WS output handler leak (message duplication) | Critical | FIXED |
| CRITICAL-2: Vestigial pipe-pane file leak + ENOENT | Critical | FIXED |
| HIGH-1: Race in initial capture snapshot | High | FIXED |
| HIGH-2: O(n*m) diff algorithm | High | Documented |
| HIGH-3: Concurrent attach() race | High | Documented |
| HIGH-4: Bridge output handler not removed on shutdown | High | Documented |
| MEDIUM-1: Queue flush dumps all messages at once | Medium | Documented |
| MEDIUM-2: Multi-line input handling | Medium | Documented |
| MEDIUM-3: 500-line capture buffer limit | Medium | Documented |
| MEDIUM-4: Fragile conversation extraction | Medium | Documented |
| MEDIUM-5: Registry persistence race | Medium | Documented |
| MEDIUM-6: EventBus listener limit | Medium | Documented |
| MEDIUM-7: No dead-session detection in polling | Medium | Documented |
| LOW-1: Permission counter not session-scoped | Low | Documented |
| LOW-2: Parser reset on every diff | Low | Documented |
| LOW-3: Synchronous trace logging | Low | Documented |
| LOW-4: Dynamic import in WS close handler | Low | Documented |
| LOW-5: Empty claudeArgs override | Low | Documented |

### Files Modified

1. **`/Users/Reason/code/ai/adjutant/backend/src/services/ws-server.ts`**
   - Added `sessionOutputHandlers` map to `WsClient` for tracking handler references
   - `handleSessionConnect`: Removes previous handler before registering new one; stores handler reference
   - `handleSessionDisconnect`: Removes the output handler before disconnecting
   - WS close handler: Removes all output handlers before cleaning up sessions
   - Added `readyState` guard and empty-line filter on raw output

2. **`/Users/Reason/code/ai/adjutant/backend/src/services/session-connector.ts`**
   - `attach()`: Removed `pipe-pane` and pipe file creation; replaced with pane existence check
   - `detach()`: Removed `pipe-pane` stop command
   - `startCapturePoll()`: Added `initialSnapshotDone` flag to prevent premature polling
   - Removed unused `writeFileSync` import
   - Used `[...this.outputHandlers]` spread when iterating handlers to guard against modification during iteration

3. **`/Users/Reason/code/ai/adjutant/backend/tests/unit/session-connector.test.ts`**
   - Updated attach test to expect `display-message` (pane check) instead of `pipe-pane`
