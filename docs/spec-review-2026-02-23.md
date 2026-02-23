# Spec Directory Review — 2026-02-23

> Full audit of all 15 specs in `specs/` to determine relevance, implementation status, and recommended action.

## Context

Adjutant is evolving from a Gastown-specific dashboard to a general-purpose agent orchestration UI. Specs tightly coupled to Gastown internals (`gt` CLI, convoys, rigs, polecats) are less relevant. Features like voice (ElevenLabs) and push notifications remain desired.

This review cross-references each spec against the actual codebase to determine what's been implemented, what's stale, and what still drives future work.

---

## Summary

| # | Spec | Action | Implementation | Gastown Coupling |
|---|------|--------|---------------|-----------------|
| 001 | pipboy-ui | **DELETE** | Fully exceeded | Moderate |
| 002 | cli-launcher | **DELETE** | Diverged | Moderate |
| 003 | convoys-ui | **DELETE** | Backend only, no frontend | Heavy |
| 004 | elevenlabs-voice | **KEEP** | Fully implemented | None |
| 005 | overseer-views | **ARCHIVE** | ~70%, rest superseded | Moderate |
| 006 | kanban-workflow | **ARCHIVE** | Deliberate simplification | Moderate |
| 007 | push-notifications | **KEEP** | ~90% complete | Light |
| 008 | agent-mcp-bridge | **ARCHIVE** | 95%+ complete | Moderate-Heavy |
| 009 | agent-chat-ui | **ARCHIVE** | Fully implemented | None |
| 010 | ios-message-investigation | **ARCHIVE** | Complete investigation | None |
| 011 | bootstrap-setup | **ARCHIVE** | Fully implemented | Light |
| 012 | mcp-streamable-http | **ARCHIVE** | Core done, CLI bug remains | None |
| 013 | agent-task-assignment | **KEEP** | ~65%, active development | Moderate |
| 014 | starcraft-callsigns | **ARCHIVE** | 100% complete | None |
| — | ios-app | **KEEP** | ~85% implemented | Moderate |

**Totals**: 3 DELETE, 7 ARCHIVE, 5 KEEP

---

## Detailed Findings

### DELETE — Remove Entirely

#### 001-pipboy-ui (9 artifacts)

**Original scope**: 3 user stories (mail inbox/outbox, power controls, crew stats) with 64 tasks.

**Current state**: The dashboard now has 60+ component files across 12 feature areas (chat, beads, epics, voice, terminal, dashboard, settings, notifications, crew, power, mail, shared). The Pip-Boy theming, React+Express architecture, and all 3 original user stories are fully implemented — and the project has grown far beyond the original vision.

**Why delete**: The spec is actively misleading. It describes a small 3-feature dashboard when the actual product is a full agent orchestration platform. References to `gt` CLI for mail and power are Gastown-specific. No future work will be guided by this spec.

**Artifacts**: spec.md, plan.md, research.md, data-model.md, contracts/openapi.yaml, quickstart.md, tasks.md, beads-import.md, checklists/requirements.md

---

#### 002-cli-launcher (9 artifacts)

**Original scope**: `adjutant` CLI command with start/shutdown/port-config (38 tasks). Detects Gastown directories via `.beads/`, calls `gt status`.

**Current state**: The CLI at `bin/cli.js` exists with `dev`, `init`, and `doctor` commands using different ports (4200/4201 vs spec's 5173/3001). The actual CLI is more practical than the spec (includes init bootstrapping, doctor health checks, hook registration via commander.js).

**Why delete**: Complete divergence. The spec describes ports, startup behavior, and Gastown directory detection that don't match reality. The implemented CLI is better than what the spec envisioned. Keeping this spec would confuse anyone reading it.

**Artifacts**: spec.md, plan.md, research.md, data-model.md, contracts/cli-interface.md, quickstart.md, tasks.md, beads-import.md, checklists/requirements.md

---

#### 003-convoys-ui (1 artifact)

**Original scope**: "CONVOYS" tab monitoring active Gastown convoys with progress bars and tracked issues.

**Current state**: Backend is complete (types, convoy-service, `GET /api/convoys` route), but no frontend components exist. Only a `plan.md` — no full spec was ever written.

**Why delete**: Convoys are a Gastown-specific concept (`bd list --type=convoy`). As Adjutant generalizes, "convoys" have no meaning. The backend route exists but isn't used. The incomplete spec (no spec.md, only plan.md) provides minimal reference value.

**Artifacts**: plan.md (only file)

---

### ARCHIVE — Move to `specs/archive/`

These specs are completed or superseded. They have reference value as historical documentation of what was built and why.

#### 005-overseer-views (2 artifacts)

**Status**: ~70% implemented

**What's done**: US1 (Mail Overseer Filter) and US2 (Beads Overseer Filter) fully implemented with `OverseerToggle` component, localStorage persistence, and filtering logic in MailView and BeadsView. `useOverseerNotifications` hook has audio notification integration.

**What's superseded**: US3 (Mayor Chat Interface) was replaced by the full MayorChat/ChatView system built as part of specs 008/009.

**Gastown coupling**: References Gastown agent roles (mayor, polecat, witness), but the filtering concept generalizes well — "overseer" = "human user" in any dashboard.

---

#### 006-kanban-workflow (3 artifacts)

**Status**: Partially implemented (deliberate simplification)

**What's done**: Full kanban board with drag-drop, optimistic updates, rig filtering, search, sort. Components: KanbanCard, KanbanColumn, KanbanBoard, useKanban hook. Backend PATCH `/api/beads/:id` endpoint.

**Deliberate divergence**: Spec called for 7 columns (BACKLOG → OPEN → IN PROGRESS → TESTING → MERGING → COMPLETE → CLOSED). Implementation uses 5 states (OPEN, HOOKED, IN_PROGRESS, BLOCKED, CLOSED) per commit a4e196f — this aligns with Gastown's actual workflow model.

**Known gaps**:
- PATCH `/api/beads/:id` has zero test coverage
- No tests for useKanban hook or kanban components

---

#### 008-agent-mcp-bridge (4 artifacts)

**Status**: 95%+ complete — backbone of the entire agent communication system

**What's done**: All 50 tasks mapped to code across 9 phases:
- Per-connection McpServer model with StreamableHTTPServerTransport
- 16 MCP tools across 4 modules (messaging, status, beads, queries)
- SQLite persistence with FTS5 full-text search
- WebSocket broadcasting for real-time delivery
- Session recovery after server restart (beyond spec)
- SimpleMutex for bd CLI serialization
- Claude Code skill + .mcp.json config
- 142 MCP tests passing across 9 test files

**Minor gaps**: Legacy beads-mail not explicitly removed (T049), no standalone AnnouncementBanner component, CLAUDE.md not updated with MCP instructions (T050).

---

#### 009-agent-chat-ui (4 artifacts)

**Status**: Fully implemented across web and iOS

**What's done**: All 6 phases complete:
- **Web**: CommandChat refactored to useChatMessages + useUnreadCounts + REST `/api/messages` + WebSocket real-time. Optimistic UI, infinite scroll pagination, search bar, empty states, system message styling.
- **iOS**: ChatViewModel, ChatView, ChatBubble all migrated to persistent messages. Agent selector with unread badges. APNS deep linking.
- **Backend**: Full `/api/messages` REST API (7 endpoints), SQLite message-store with FTS5, WebSocket broadcasting with rate limiting and replay buffer.

**Known bug**: Backend search route `/api/messages/search` NOT implemented — frontend calls it but it will 404. The `messageStore.searchMessages()` method exists but no route handler. ~5 minute fix.

---

#### 010-ios-message-investigation (11 artifacts)

**Status**: Complete investigation — all critical fixes applied

**What was found**: 4 root-cause failures (blank chat on open, messages lost after backgrounding, broken pagination, intermittent WebSocket). Investigation produced 7 spec documents totaling ~3,500 lines of forensic documentation.

**What was fixed**:
- All 4 Tier 1 root-cause fixes applied (commits e3655a3, 216d0b7, d6d88e8)
- 6/7 Tier 2 reliability fixes applied
- 9/10 Tier 3 UX polish items applied
- 118 regression tests added (60 backend, 58 frontend)

**Remaining**: WS reconnect on network restoration (nice-to-have), WebSocketClient thread safety improvement.

**Archive value**: Invaluable forensic reference for the message pipeline. The investigation-findings.md, staff-review-findings.md, and ux-audit-findings.md documents are onboarding material for anyone working on the messaging system.

---

#### 011-bootstrap-setup (4 artifacts)

**Status**: Fully implemented (epic adj-013, CLOSED)

**What's done**: `adjutant init` and `adjutant doctor` via commander.js CLI:
- 15 health checks across files, network, tools, and hooks
- Hook registration (SessionStart + PreCompact)
- .mcp.json creation with safe JSON merge
- PRIME.md generation, --force flag, idempotent behavior
- Tests: cli-init.test.ts, cli-doctor.test.ts, cli-hooks.test.ts

**Note**: CLI requires `npm run build:cli` before use (dist/ not in repo). This is a packaging concern, not a spec gap.

---

#### 012-mcp-streamable-http (4 artifacts)

**Status**: Core transport migration complete

**What's done**: SSE replaced with StreamableHTTP on POST/GET/DELETE `/mcp`. Per-session transport model, session recovery (beyond spec), identity resolution from headers. 142 tests passing. All existing MCP tools work unchanged.

**Known bug**: CLI still references old SSE endpoints:
- `cli/commands/init.ts:33` writes old `supergateway --sse http://localhost:4201/mcp/sse`
- `cli/commands/doctor.ts:96` health-checks old `/mcp/sse` endpoint

These should be filed as a bug bead and fixed separately.

---

#### 014-starcraft-callsigns (2 artifacts)

**Status**: 100% complete — nothing remaining

**What's done**: All 4 user stories and 12 functional requirements:
- Backend: callsign-service.ts with 44 callsigns (15 Terran, 13 Zerg, 16 Protoss), Fisher-Yates shuffle, uniqueness checking, fallback naming
- Routes: GET `/api/sessions/callsigns` + POST `/api/sessions` with auto-assign
- iOS: CallsignPickerView with race tabs, long-press gesture, availability indicators
- Swarm integration: `createSwarm()` uses `pickRandomCallsigns(count)`
- Tests: 225+ tests across 3 suites

---

### KEEP — Still Active or Needed

#### 004-elevenlabs-voice (7 artifacts)

**Status**: Fully implemented but spec has future refinement detail

**What's done**: All 7 phases and 60 tasks complete:
- Backend: ElevenLabs client, audio caching with file locking, notification queue, voice config persistence
- Frontend: 8 voice components (1,300+ LOC) — playback, recording, notifications, config panel
- API: 13 routes in `backend/src/routes/voice.ts` (531 LOC)
- Integration: MailDetail, ComposeMessage, PipBoyFrame header
- Tests: 250+ backend tests

**Why keep**: The spec's verification.md and performance.md contain Phase 2+ optimization targets (streaming TTS, voice cloning, multilingual) that haven't been attempted. Good reference for future voice work.

**Gastown coupling**: None — completely standalone feature.

---

#### 007-push-notifications-live-activities (1 artifact)

**Status**: ~90% complete

**What's done**: Production-ready across 6 phases:
- iOS: NotificationService (5 categories, action handlers, badge management), AppDelegate (push registration, remote notification handling), BackgroundTaskService (BGTaskScheduler with 15-min refresh), LiveActivityService (ActivityKit with Dynamic Island)
- Backend: apns-service.ts (@parse/node-apn), device-token-service.ts, REST routes for device management

**What remains**: Dedicated NotificationSettingsView UI (currently embedded in voice components), some Phase 2 polish items.

**Why keep**: Spec covers the remaining work and has the full Phase 1-6 breakdown that guides completion.

**Gastown coupling**: Light — notification payloads reference beads/mail but the mechanism is generic.

---

#### 013-agent-task-assignment (9 artifacts)

**Status**: ~65% complete — active development

**What's done**:
- Backend: `PATCH /api/beads/:id` accepts assignee, `updateBead()` handles status transitions, `api.beads.assign()` frontend API, MCP tools support `--assignee`
- Recent commits: cca8fa1 (Feb 22), 6779601 (Feb 22)

**Critical blocker**: `AgentAssignDropdown` shared UI component. Once built, it plugs into KanbanCard, BeadsList, EpicDetailView, and EpicCard.

**Why keep**: Active development with 17 open beads. Spec is well-structured and remaining work clearly defined.

---

#### ios-app (3 artifacts)

**Status**: ~85% implemented

**What exists**: 169 Swift source files, MVVM+Coordinator architecture, AdjutantKit networking framework, 14 feature modules, 6-theme CRT design system, voice integration, Live Activities, WebSocket client, 25+ test files.

**Artifacts**: api-contract.md, beads.md, frontend-features.md

**What's stale**: api-contract.md references Gastown-specific endpoints and terminology. Doesn't cover newer features (sessions, swarm mode, permissions).

**Why keep**: iOS app is actively developed. Specs need updating for the general-dashboard direction but still provide useful architecture reference.

---

## Discovered Bugs

Three issues found during the review that should be filed as beads:

| Bug | Source Spec | Severity | Effort |
|-----|------------|----------|--------|
| Missing `/api/messages/search` route — frontend calls it, store method exists, no handler | 009 | Medium | ~5 min |
| Stale SSE refs in CLI — `init.ts:33` writes old supergateway config, `doctor.ts:96` checks `/mcp/sse` | 012 | Low | ~10 min |
| Missing PATCH `/api/beads/:id` test coverage — endpoint works but zero tests | 006 | Low | ~30 min |

---

## Recommended Execution Plan

1. **Create `specs/archive/`** and move 7 completed specs there
2. **Delete** 001-pipboy-ui, 002-cli-launcher, 003-convoys-ui entirely
3. **Keep** 004, 007, 013, ios-app in `specs/` as active specs
4. **File 3 bug beads** for discovered issues
5. **Update ios-app specs** to remove Gastown-specific terminology (separate task)
