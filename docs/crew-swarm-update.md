# Crew Tab Swarm Mode Update

> Epic: adj-d5g | Priority: P1
> Goal: Transform the Crew tab into a real-time swarm command center showing all active agents and what they're working on.
>
> **Bead Map:**
> - `adj-d5g` — Root epic
>   - `adj-49u` — Track A: Backend data enrichment
>     - `adj-413` — A1: Extend CrewMember type (P1, **START HERE**)
>     - `adj-zf4` — A2: Generalize terminal endpoint (blocked by A1)
>     - `adj-dyj` — A3: Swarm summary endpoint (blocked by A1)
>     - `adj-cfq` — A4: WebSocket agent status events (blocked by A1)
>   - `adj-q92` — Track B: Frontend UI redesign
>     - `adj-35p` — B1: Swarm overview panel (blocked by A1)
>     - `adj-4as` — B2: Enhanced agent cards (blocked by A1)
>     - `adj-wvh` — B3: Status-based grouping (blocked by A1)
>     - `adj-8u0` — B4: Inline terminal expansion (blocked by A2, B2)
>   - `adj-8j4` — Track C: Real-time updates
>     - `adj-w1j` — C1: useSwarmAgents hook (blocked by A1, A4)
>     - `adj-38q` — C2: Terminal WebSocket streaming (blocked by A2, B4)
>     - `adj-i1w` — C3: Reduce polling to 10s (**START HERE**)
>   - `adj-en1` — Track D: Agent controls
>     - `adj-v84` — D1: Spawn agent button (blocked by B1)
>     - `adj-ie7` — D2: Remove agent (blocked by B2)
>     - `adj-cnz` — D3: Assign bead to agent (blocked by B2)

## Problem Statement

The Crew tab currently handles swarm mode with a minimal flat list of "peers" (user/agent types). While the backend has robust swarm infrastructure (SwarmService, SessionBridge, SessionRegistry with WebSocket support, tmux integration), the frontend barely uses it. Agents show as simple cards with name/status — there's no real visibility into **what each agent is actively doing**, no live updates, and no agent management controls.

For swarm mode to be useful as a command center, the operator needs to see at a glance:
- Which agents are active and what task each is working on
- Real-time status changes (not 60-second polling)
- Agent terminal output without leaving the tab
- Ability to spawn/remove agents and assign work

## Current Architecture

### Frontend
- **CrewStats.tsx** (1374 lines) — Main component, handles both GT and swarm modes
- **useDashboardCrew.ts** — Simple hook, polls `api.agents.list()` once on mount (60s)
- **CrewMember type** — `{ id, name, type, rig, status, currentTask?, unreadMail, branch?, sessionId? }`
- Swarm agents grouped as `peers[]` in flat list under "SWARM AGENTS" header

### Backend
- **agents-service.ts** — `getAgents()` → in swarm mode uses `getTmuxAgents()`
- **agent-data.ts** — `collectAgentSnapshot()` discovers agents from beads + tmux + mail index
- **swarm-service.ts** — Full CRUD: create swarm, add/remove agents, merge branches (in-memory registry)
- **session-registry.ts** — `ManagedSession` with WebSocket streaming, output buffer, status tracking
- **session-bridge.ts** — Bridges SessionRegistry with agent discovery
- **Topology** — SwarmTopology: `user` (coordinator) + `agent` (workers), no rig hierarchy

### Data Available But Not Exposed to Crew Tab
| Data | Source | Currently Used? |
|------|--------|----------------|
| Agent tmux session output | `tmux capture-pane` / session-registry outputBuffer | Only for polecats |
| Agent git branch | worktree HEAD | Partially (polecats only) |
| Hook bead title (current task) | `bd show <hookBead>` | Yes but minimal display |
| Agent state transitions | session-registry status changes | Not pushed to UI |
| Swarm metadata (id, agents, coordinator) | swarm-service in-memory | Not shown in crew tab |
| Last activity timestamp | session-registry lastActivity | Not exposed |
| WebSocket live streaming | session-registry connectedClients | Not used in crew tab |

## Design

### Track A: Backend Data Enrichment (adj-010.1)

Enrich the agent data pipeline so the Crew tab has everything it needs.

**A1. Extend CrewMember response type** (`adj-010.1.1`)
Add fields to `CrewMember` in both backend and frontend types:
```typescript
interface CrewMember {
  // ... existing fields ...
  lastActivity?: string;        // ISO timestamp from session-registry
  worktreePath?: string;        // Git worktree path (swarm agents)
  progress?: {                  // From beads assigned to agent
    completed: number;
    total: number;
  };
  swarmId?: string;             // Which swarm this agent belongs to
  isCoordinator?: boolean;      // Is this the merge coordinator?
}
```

**A2. Generalize terminal endpoint for swarm agents** (`adj-010.1.2`)
Current: `GET /api/agents/:rig/:polecat/terminal` — hardcoded to `gt-{rig}-{polecat}` session pattern.
Need: Support swarm agent sessions (`agent-{name}` pattern) and user sessions.
New route: `GET /api/agents/:sessionName/terminal` or detect mode and route accordingly.

**A3. Add swarm summary endpoint** (`adj-010.1.3`)
```
GET /api/swarms/active → {
  id: string,
  agentCount: number,
  activeCount: number,
  idleCount: number,
  blockedCount: number,
  overallProgress: { completed: number, total: number },
  createdAt: string
}
```

**A4. WebSocket agent status events** (`adj-010.1.4`)
The session-registry already tracks status changes and emits `agent:status_changed` events. Wire this to a WebSocket endpoint that the Crew tab can subscribe to:
```
WS /api/agents/stream → { type: "status_change", agent: string, from: status, to: status, timestamp: string }
```

### Track B: Frontend Crew Tab Redesign (adj-010.2)

Redesign the swarm mode rendering in CrewStats to be information-dense and real-time.

**B1. Swarm overview panel** (`adj-010.2.1`)
Top-of-tab summary when in swarm mode:
- Agent count badges: `4 ACTIVE | 1 IDLE | 1 BLOCKED`
- Overall progress bar from beads
- Swarm uptime / created timestamp
- Quick-action buttons (spawn agent, etc.)

**B2. Enhanced agent cards** (`adj-010.2.2`)
Replace the minimal peer cards with rich agent cards:
- **Header**: Agent name + status indicator (color-coded dot)
- **Current task**: Hook bead title with bead ID link
- **Branch**: Git branch name with diff stat if available
- **Last activity**: Relative timestamp ("2m ago")
- **Terminal preview**: Last 3-5 lines of output (collapsed by default)
- **Unread mail**: Badge with sender preview
- **Actions**: Expand terminal, send message, remove agent

**B3. Agent grouping by status** (`adj-010.2.3`)
Group and sort agents by status priority:
1. `working` — Active agents first (most important)
2. `blocked` — Need attention
3. `idle` — Available for work
4. `offline` — Dead/removed agents (collapsed)

Within each group, sort by last activity (most recent first).

**B4. Inline terminal expansion** (`adj-010.2.4`)
Click an agent card to expand and show live terminal output:
- Reuse xterm.js integration from polecat terminal
- WebSocket streaming from session-registry
- Auto-scroll with pause-on-scroll
- Resize handle

### Track C: Real-time Updates (adj-010.3)

Replace polling with push-based updates for swarm mode.

**C1. useSwarmAgents hook** (`adj-010.3.1`)
New hook that combines:
- Initial fetch via `api.agents.list()`
- WebSocket subscription for status changes
- Optimistic UI updates on status change events
- Fallback to polling if WebSocket disconnects

**C2. Agent terminal WebSocket** (`adj-010.3.2`)
Wire session-registry's pipe-pane output to the inline terminal:
- Connect to existing `tmux pipe-pane` infrastructure
- Buffer management (ring buffer, max 1000 lines)
- Reconnection logic

**C3. Reduce polling interval** (`adj-010.3.3`)
For swarm mode, reduce the base polling interval from 60s to 10s as a fallback, with WebSocket as primary. This ensures data freshness even if WebSocket drops.

### Track D: Agent Controls (adj-010.4)

Add operator controls for swarm management from the Crew tab.

**D1. Spawn agent button** (`adj-010.4.1`)
- Button in swarm overview panel
- Calls existing `POST /api/swarms/:id/agents`
- Shows spawning state with terminal output
- Agent appears in list once session is registered

**D2. Remove agent** (`adj-010.4.2`)
- Context menu or button on agent card
- Confirmation dialog ("Agent alice is working. Remove anyway?")
- Calls existing `DELETE /api/swarms/:id/agents/:sessionId`
- Handles graceful vs force removal

**D3. Assign bead to agent** (`adj-010.4.3`)
- "Assign work" action on idle agent cards
- Bead picker (shows ready beads from `bd ready`)
- Updates hook bead assignment
- Agent card immediately reflects new task

## Parallel Execution Plan

```
Track A (Backend)          Track B (Frontend)         Track C (Real-time)      Track D (Controls)
─────────────────         ──────────────────         ─────────────────        ─────────────────
A1: Extend types    ──┐   B1: Overview panel   ──┐   C3: Faster polling      D1: Spawn button
A2: Terminal route  ──┤   B2: Agent cards      ──┤   C1: useSwarmAgents ──┐  D2: Remove agent
A3: Summary endpoint──┘   B3: Status grouping  ──┘   C2: Terminal WS    ──┘  D3: Assign bead
A4: WS status events ────────────────────────────────→ (feeds C1)
                     │                          │
                     └── B depends on A types ──┘
```

**Dependencies:**
- Track B depends on Track A (needs enriched data types)
- Track C depends on Track A (needs WS endpoint) and Track B (needs UI to connect)
- Track D depends on Track B (needs agent cards with action slots)
- Within Track A: A1 first (types), then A2-A4 in parallel
- Within Track B: B1-B3 in parallel, B4 after B2 (needs card layout)

**Parallel opportunities:**
- A2, A3, A4 can run simultaneously after A1
- B1, B2, B3 can run simultaneously (mock data until A completes)
- C3 is independent, can start immediately
- D1, D2 can start once B2 provides the card layout

## Testing Strategy

- **Backend**: Unit tests for enriched agent-data, new endpoints (mock bd/tmux)
- **Frontend**: Hook tests for useSwarmAgents, component tests for new cards
- **Integration**: WebSocket connection lifecycle, terminal streaming
- TDD per project rules: write failing test → implement → verify

## Files Likely Modified

### Backend
- `backend/src/types/index.ts` — Extended CrewMember type
- `backend/src/services/agents-service.ts` — Enriched agent data
- `backend/src/services/agent-data.ts` — Additional data collection
- `backend/src/routes/agents.ts` — New/modified endpoints
- `backend/src/routes/swarms.ts` — Summary endpoint

### Frontend
- `frontend/src/types/index.ts` — Extended CrewMember type
- `frontend/src/components/crew/CrewStats.tsx` — Major refactor for swarm mode
- `frontend/src/hooks/useDashboardCrew.ts` — Enhanced or replaced by useSwarmAgents
- `frontend/src/hooks/useSwarmAgents.ts` — New hook (WebSocket + polling)
- `frontend/src/services/api.ts` — New API methods

### Tests
- `backend/tests/unit/agents-service.test.ts` — Extended
- `frontend/tests/unit/useSwarmAgents.test.ts` — New
