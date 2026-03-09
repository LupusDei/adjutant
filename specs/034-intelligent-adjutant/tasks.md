# Tasks — Intelligent Adjutant

## Phase 1: Signal Aggregator

- [ ] T001 [US1] Create SignalAggregator class with signal buffer and two-tier classification (critical → wake, context → accumulate silently). Critical signals notify the stimulus engine. Snapshot method returns accumulated context since last drain. In `backend/src/services/adjutant/signal-aggregator.ts`
- [ ] T002 [US1] Add deduplication logic (collapse repeated events from same source within 30s window) and auto-expiry (signals older than 30 minutes) in `backend/src/services/adjutant/signal-aggregator.ts`
- [ ] T003 [US1] Register SignalAggregator as an EventBus listener in AdjutantCore initialization, wire into `backend/src/index.ts`

## Phase 2: Stimulus Engine

- [ ] T004 [US2] Create StimulusEngine class with three wake sources: critical signal callback, scheduled check queue (setTimeout-based), and event watch registry. 90-second cooldown between prompts. Queue critical events during cooldown. In `backend/src/services/adjutant/stimulus-engine.ts`
- [ ] T005 [US2] Build situation prompt template: wake reason, accumulated context signals (drained from aggregator), state snapshot (agents + beads), pending watches/checks, recent decisions, available actions. Plus bootstrap prompt for startup. Format for tmux single-line injection. In `backend/src/services/adjutant/stimulus-engine.ts`
- [ ] T006 [US2] Replace periodic-summary: remove its registration from index.ts, register stimulus engine instead. Bootstrap prompt fires 60s after startup. In `backend/src/index.ts` and `backend/src/services/adjutant/behaviors/periodic-summary.ts` (to be deleted in Phase 6)

## Phase 3: Action Tools

- [ ] T007 [P] [US3] Implement `spawn_worker` MCP tool — wraps agent-spawner-service, accepts prompt + optional beadId, logs decision with reasoning in `backend/src/services/mcp-tools/coordination.ts`
- [ ] T008 [P] [US3] Implement `assign_bead` MCP tool — wraps bd-client update + bead:assigned event, accepts beadId + agentId + reason in `backend/src/services/mcp-tools/coordination.ts`
- [ ] T009 [P] [US3] Implement `nudge_agent` MCP tool — wraps SessionBridge.sendInput() to inject a prompt into agent's tmux session in `backend/src/services/mcp-tools/coordination.ts`
- [ ] T010 [P] [US3] Implement `decommission_agent` and `rebalance_work` MCP tools — graceful shutdown + orphaned bead return in `backend/src/services/mcp-tools/coordination.ts`
- [ ] T011 [P] [US3] Implement `schedule_check` and `watch_for` MCP tools — schedule_check registers a delayed wake-up in the stimulus engine, watch_for registers a conditional wake-up (event match or timeout) in `backend/src/services/mcp-tools/coordination.ts`
- [ ] T012 [US3] Add adjutant-only access guard — check caller identity via getAgentBySession(), reject non-adjutant callers for coordination tools in `backend/src/services/mcp-tools/coordination.ts`

## Phase 4: Adjutant Prompt Update

- [ ] T013 [US4] Rewrite adjutant agent prompt with event-driven reasoning framework, self-scheduling patterns (schedule checks after actions, watch for outcomes), decision guidelines, spawn budget awareness, and action tool documentation in `.claude/agents/adjutant.md`

## Phase 5: Decision Feedback

- [ ] T014 [US5] Extend state store with outcome tracking — link spawn/assignment decisions to bead completion events, track time-to-completion in `backend/src/services/adjutant/state-store.ts`
- [ ] T015 [US5] Include recent decision outcomes in stimulus prompt template as context in `backend/src/services/adjutant/stimulus-engine.ts`

## Phase 6: Cleanup

- [ ] T016 [US6] Delete old disabled behavior files (work-assigner, work-rebalancer, agent-spawner, agent-decommissioner, stale-agent-nudger, build-monitor, quality-gate, periodic-summary) and their test files, remove dead imports from `backend/src/index.ts`
