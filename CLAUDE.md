# Adjutant

Adjutant is a standalone multi-agent dashboard backed by beads (issue tracking) and MCP (agent communication).

## Active Technologies
- TypeScript 5.x (strict mode) + React 18+, Express, Tailwind CSS, Zod
- SQLite (message store + full-text search), bd CLI (beads issue tracking)
- MCP via SSE transport (agent connections)
- WebSocket (real-time chat), APNS (iOS push notifications)

## Key Concepts
- **Beads**: Issue tracking via `bd` CLI — epics, tasks, bugs with hierarchical dependencies
- **Agents**: Connect via MCP SSE, use tools for messaging, status reporting, and bead management
- **Messages**: Persistent SQLite-backed chat between agents and user, with WebSocket real-time delivery
- **Conversations**: The unified chat model (adj-164). Every message belongs to one
  first-class `conversation` with a `kind` discriminator — `dm` (1:1, exactly two
  members) or `channel` (Slack-style multi-party room). DMs and channels are the SAME
  entity + a `conversation_members` table, NOT two systems. See "Conversation Model" in
  `.claude/rules/04-architecture.md` and `specs/055-chat-messaging-overhaul/`.
- **Question Triage**: First-class agent question/answer system (adj-181). Agents MUST use
  `file_question` MCP tool for ANYTHING they need from the General — both questions and
  blocking tasks/actions (Constitution Rule 5). A triage view (web + iOS) aggregates open
  questions sorted blocking → high → normal → low; answering notifies the asker via DM;
  new blocking/high questions push APNS. See "Question Triage" in `.claude/rules/04-architecture.md`.
- **Dashboard**: Retro terminal themed web UI showing agents, beads, chat, and system state

### Conversation Model (chat — adj-164)
- **Why**: a stable `messages.conversation_id` is the single scoping key. It replaced the
  fragile `(agent_id OR (role='user' AND recipient=…))` reconstruction that caused
  wrong-thread bleed. DMs resolve to a deterministic id (`dmConversationId`/`getOrCreateDm`),
  so the same pair always maps to the same conversation across REST/WS/MCP.
- **DMs**: broadcast to all authenticated clients and scoped client-side (per-conversation).
- **Channels**: room-scoped. `wsBroadcastToConversation` delivers ONLY to member +
  subscribed clients; the WS sync/replay path is membership-gated for channel kinds
  (DMs replay freely). MCP tools: `create_channel`, `list_channels`, `join_channel`,
  `leave_channel`; `send_message` accepts a `conversationId` to post to a channel.
- **Search**: `searchMessages` accepts `conversationId` for bleed-free FTS scoping
  (`GET /api/messages/search?q=&conversationId=`).
- **Platforms**: web (React `CommandChat`/`ChannelView`) and iOS (SwiftUI `ChatView`/
  `ChannelView`) both scope all reads/writes/real-time by `conversationId`.

## Pre-Push Verification

A standalone verification script exists at `scripts/verify-before-push.sh`. It runs lint, **typecheck (`tsc --noEmit`)**, and tests (using `vitest run --changed` for speed, falling back to full suite) before pushing. The typecheck step exists because `vitest` does not typecheck and `vite build` strips types via esbuild, so without it a type error passes lint+tests yet breaks `npm run build` at merge time (see adj-181.3.8).

- **Backend typecheck is blocking** (backend is clean).
- **Frontend typecheck is a ratchet**: the frontend was never typechecked before and carries a baseline of pre-existing errors in `frontend/.tsc-baseline`. The gate blocks only on a *regression above the baseline*, so new type errors are caught without freezing the team on legacy debt. Burn the baseline down to 0 (adj-70idj), then drop the ratchet and make it plain-blocking like the backend.

- **Agents MUST run `./scripts/verify-before-push.sh` before every `git push`** (enforced via spawn prompts, not git hooks)
- **WIP branches** (`wip/*`) are automatically exempt — the script detects and skips them
- **Why a script instead of a git hook?** Beads owns the `.git/hooks/pre-push` hook via bd-shim. Installing a separate pre-push hook would conflict. The script achieves the same goal without hook conflicts

## Performance Budgets

Frontend perf budgets live in `frontend/perf-budgets.md`. Run with `RUN_PERF=1 npm run test:perf` against a production preview build (`npm run build && npm run preview`). Do NOT measure perf against `npm run dev` — dev mode obscures regressions.

The Puppeteer-based budgets (`leak-overview.test.ts`, `keystroke-latency.test.ts`) are gated behind `RUN_PERF=1` and auto-skip in the default vitest suite. The formatter-cache benchmark always runs.
