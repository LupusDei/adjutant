# AdjutantMode Manual Testing Plan (V2)

## Prerequisites

### 1. Start the Backend
```bash
cd adjutant/backend
npm install
npm run dev       # Port 4201 with WS + SSE
```

### 2. Start the Frontend
```bash
cd adjutant/frontend
npm install
npm run dev       # Port 4200, proxies API to 4201
```

### 3. Open iOS
```
open adjutant/ios/Adjutant.xcodeproj
# Run on simulator, configure server URL in Settings
```

---

## Test Cases

### 1. Mode Switching

- [ ] Open Settings (frontend or iOS)
- [ ] Current mode should auto-detect (GT Mode if in Gas Town)
- [ ] Switch to **Single Agent** — tabs should drop to: Chat, Beads, Settings
- [ ] Switch to **Swarm** — tabs: Chat, Crew, Beads, Settings
- [ ] Switch back to **GT Mode** — all 7 tabs appear
- [ ] If other client is open, verify SSE pushes mode change to it too
- [ ] Unavailable modes should be grayed out with a reason

### 2. Communication Priority

- [ ] In Settings, switch priority to **Real-Time** — chat indicator should show `WS` (green)
- [ ] Switch to **Efficient** — indicator shows `SSE` (yellow)
- [ ] Switch to **Polling Only** — indicator shows `HTTP` (gray)
- [ ] Priority persists after closing and reopening the app/browser

### 3. Chat (WebSocket)

- [ ] Send a message in Chat — should deliver via WebSocket (in Real-Time mode)
- [ ] Verify connection indicator in chat header shows `WS`
- [ ] Verify delivery confirmation (message stops showing "sending" state)
- [ ] If backend streams a response, verify token-by-token rendering
- [ ] Typing indicator appears when agent is composing

### 4. SSE Events

- [ ] With frontend running, send mail via backend or another client
- [ ] Verify the event appears in real-time without page refresh
- [ ] Verify bead updates push through SSE (create/update a bead)
- [ ] Verify agent status changes appear via SSE

### 5. Fallback Chain

- [ ] Kill the WebSocket (stop/restart backend briefly)
- [ ] Chat should show `RECONNECTING` then fall back to SSE or HTTP
- [ ] Messages should still send via HTTP fallback
- [ ] Restart backend — WebSocket should auto-reconnect
- [ ] Verify reconnection indicator clears once connection restored

### 6. Cross-Platform Consistency

- [ ] Open both iOS and Frontend simultaneously
- [ ] Switch mode on one client — verify the other client updates via SSE
- [ ] Send a chat message from iOS — verify it appears on frontend (and vice versa)
- [ ] Both clients show the same tabs for the same mode

### 7. Settings UI

- [ ] Mode switcher shows 3 cards: Gas Town, Single Agent, Swarm
- [ ] Active mode has green/active indicator
- [ ] Communication priority shows 3 options: Real-Time, Efficient, Polling Only
- [ ] Connection status displayed next to priority selector

### 8. Edge Cases

- [ ] Switch modes rapidly — no crash, UI settles to final mode
- [ ] Disconnect network — reconnection backoff works (1s → 2s → 4s → 30s cap)
- [ ] Send message while disconnected — HTTP fallback delivers it
- [ ] Close and reopen browser/app — mode and priority restored from storage
