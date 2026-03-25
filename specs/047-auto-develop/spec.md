# Feature: Auto-Develop — Continuous Autonomous Project Development Loop

**Spec ID**: 047
**Proposal**: `d0db5769-da39-4004-8436-3032ed060d76`
**Type**: Product + Engineering
**Priority**: P1

## Overview

A per-project `autoDevelop` flag that transforms Adjutant from a human-driven assistant into a fully autonomous development loop. When enabled, the coordinator continuously generates proposals, reviews them through confidence gates, and executes accepted proposals as epics — all without human intervention. Low-confidence proposals escalate to the user with structured "vision update" requests.

## User Stories

### US1: Enable/Disable Auto-Develop (Priority: P0)

**As** a project owner,
**I want** to toggle auto-develop mode on a per-project basis,
**So that** I can let Adjutant autonomously improve my project when I'm away.

**Acceptance Criteria:**
- [ ] `PATCH /api/projects/:id` accepts `{ autoDevelop: boolean }` and persists it
- [ ] MCP tool `enable_auto_develop` activates auto-develop for the agent's project with optional `visionContext`
- [ ] MCP tool `disable_auto_develop` immediately halts all autonomous proposal generation and execution for the project
- [ ] Dashboard project settings show an auto-develop toggle
- [ ] iOS app project view shows an auto-develop toggle
- [ ] Enabling emits `project:auto_develop_enabled` event; disabling emits `project:auto_develop_disabled` event
- [ ] Default is OFF for all projects

### US2: Confidence Gate System (Priority: P0)

**As** the auto-develop loop,
**I want** to score proposals on a 0-100 confidence scale using multiple signals,
**So that** only high-quality proposals proceed to execution automatically.

**Acceptance Criteria:**
- [ ] `score_proposal` MCP tool accepts per-signal scores from reviewer agents: `reviewerConsensus`, `specClarity`, `codebaseAlignment`, `riskAssessment`, `historicalSuccess`
- [ ] Weighted composite score computed: consensus 30%, clarity 20%, alignment 20%, risk 15%, history 15%
- [ ] Score 80-100: auto-accept proposal, transition to PLAN phase
- [ ] Score 60-79: send back for revision (max 3 rounds), then escalate if still below 80
- [ ] Score 40-59: escalate to user with structured "vision update needed" message
- [ ] Score 0-39: auto-dismiss with logged reason
- [ ] `confidence_score`, `confidence_signals`, `review_round`, `auto_generated` columns added to proposals table
- [ ] All gate decisions logged in `adjutant_decisions`

### US3: Auto-Develop Loop Behavior (Priority: P0)

**As** the Adjutant coordinator,
**I want** a registered behavior that drives the 7-phase development loop,
**So that** auto-develop projects continuously improve without human intervention.

**Acceptance Criteria:**
- [ ] `auto-develop-loop` behavior registered in BehaviorRegistry
- [ ] Triggers: `project:auto_develop_enabled`, `bead:closed`, `proposal:completed` events, plus 30-minute cron heartbeat
- [ ] Phase 1 (ANALYZE): Examines project state — open beads, recent proposals, codebase gaps
- [ ] Phase 2 (IDEATE): Spawns ideation agent to create product/engineering proposals
- [ ] Phase 3 (REVIEW): Spawns reviewer agent(s) to critique and score proposals
- [ ] Phase 4 (GATE): Applies confidence thresholds (accept/refine/escalate/dismiss)
- [ ] Phase 5 (PLAN): Converts accepted proposal to epic hierarchy via epic-planner
- [ ] Phase 6 (EXECUTE): Spawns squad to implement epic via squad-execute
- [ ] Phase 7 (VALIDATE): QA + code review on completed work
- [ ] Loop restarts at ANALYZE after VALIDATE completes
- [ ] Concurrency limits enforced: max 3 proposals in review, max 2 epics in execution per project
- [ ] Backpressure: pauses at EXECUTE when agent slots full, resumes when slots free
- [ ] Cycle tracking: each loop iteration logged in `auto_develop_cycles` table

### US4: Vision Update Escalation (Priority: P1)

**As** a project owner,
**I want** to receive structured escalation messages when the auto-develop loop has low confidence,
**So that** I can provide direction without micromanaging.

**Acceptance Criteria:**
- [ ] When proposals consistently score 40-59, coordinator sends structured "Vision Update Needed" message via MCP + APNS push
- [ ] Message includes: project name, top low-confidence proposals with scores and primary concerns, specific guidance requests
- [ ] `provide_vision_update` MCP tool accepts user's direction text, stores in `projects.vision_context`, and unpauses the loop
- [ ] Loop pauses proposal generation after escalation; resumes when user responds or 24h timeout
- [ ] `auto_develop_paused_at` timestamp tracked on projects table
- [ ] iOS app shows escalation banner with inline response capability

### US5: iOS App Auto-Develop Controls (Priority: P1)

**As** a mobile user,
**I want** to toggle auto-develop and monitor the loop from my iPhone,
**So that** I can manage autonomous development on the go.

**Acceptance Criteria:**
- [ ] Project detail view includes auto-develop toggle switch
- [ ] Auto-develop status panel shows: current loop phase, active proposals with confidence scores, cycle history
- [ ] Escalation banner appears prominently when vision update is needed
- [ ] Inline text field for providing vision updates directly from the escalation banner
- [ ] APNS push notifications for: auto-develop enabled/disabled, proposal accepted/escalated, cycle completed, vision update needed
- [ ] Real-time updates via existing WebSocket connection

### US6: Auto-Develop Dashboard Panel (Priority: P2)

**As** a dashboard user,
**I want** a dedicated auto-develop panel on the web dashboard,
**So that** I can see the full picture of autonomous development activity.

**Acceptance Criteria:**
- [ ] Auto-develop toggle in project settings with status indicator (active/paused/escalated)
- [ ] Auto-develop panel shows: current phase, proposal pipeline with confidence scores, concurrency usage
- [ ] Escalation banner with inline response when vision update needed
- [ ] Cycle history timeline: proposal -> epic -> completion flow
- [ ] Safety controls: kill switch, pause/resume

### US7: Auto-Develop MCP Query Tools (Priority: P2)

**As** an agent or external system,
**I want** to query auto-develop status via MCP tools,
**So that** I can coordinate with the autonomous loop.

**Acceptance Criteria:**
- [ ] `get_auto_develop_status` returns: enabled flag, current phase, active proposals with scores, paused status, cycle stats
- [ ] Status scoped to agent's project (cross-project access denied)
- [ ] REST endpoint `GET /api/projects/:id/auto-develop` returns same data for dashboard/iOS

## Requirements

### Functional
- F1: Auto-develop is per-project — multiple projects can have it enabled simultaneously
- F2: The loop respects existing agent budget (MAX_SESSIONS) and spawn controls
- F3: All auto-develop decisions are logged in `adjutant_decisions` with full context
- F4: Disabling auto-develop immediately halts the loop (no in-flight proposals continue to acceptance)
- F5: Auto-generated proposals are flagged (`auto_generated: true`) and distinguishable from human/agent proposals
- F6: The confidence scoring system is extensible — new signals can be added without schema changes (JSON blob)

### Non-Functional
- NF1: Loop heartbeat (30 min) must not degrade coordinator responsiveness for manual tasks
- NF2: Confidence scoring computation must complete in < 100ms
- NF3: Auto-develop state queries must respond in < 50ms (indexed SQLite)
- NF4: iOS push notifications for escalations must arrive within 30 seconds

### Safety
- S1: Kill switch — disabling auto-develop is always immediate and irreversible for the current cycle
- S2: Scope guardrails — proposals touching CI/CD, deployment, or security paths force escalation regardless of confidence score
- S3: Spend cap (optional) — max agents-per-hour to control compute costs
- S4: All work on feature branches — no direct-to-main merges from auto-develop
- S5: Vision anchoring — proposals that drift from `vision_context` score lower on codebase alignment

## Success Criteria

1. A project with auto-develop enabled completes at least one full ANALYZE → VALIDATE cycle without human intervention
2. Low-confidence proposals (40-59) are correctly escalated with actionable guidance requests
3. High-confidence proposals (80+) are auto-accepted, planned, and executed end-to-end
4. The user can monitor and control the loop from both dashboard and iOS app
5. Disabling auto-develop halts the loop within one heartbeat cycle (30 min max, immediate for in-progress gates)
6. Full audit trail visible in decision log
