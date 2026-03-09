# Beads Import — Intelligent Adjutant

## Root Epic

| Bead ID | Type | Title | Priority |
|---------|------|-------|----------|
| adj-054 | epic | Intelligent Adjutant — Signal-Driven Coordination | P1 |

## Sub-Epics

| Bead ID | Type | Title | Priority | Phase |
|---------|------|-------|----------|-------|
| adj-054.1 | epic | Signal Aggregator | P1 | 1 |
| adj-054.2 | epic | Stimulus Engine | P1 | 2 |
| adj-054.3 | epic | Action Tools | P1 | 3 |
| adj-054.4 | epic | Adjutant Prompt Update | P1 | 4 |
| adj-054.5 | epic | Decision Feedback Loop | P2 | 5 |
| adj-054.6 | epic | Cleanup — Remove Old Behaviors | P2 | 6 |

## Tasks

### Phase 1: Signal Aggregator

| T-ID | Bead ID | Title | Parallel | User Story |
|------|---------|-------|----------|------------|
| T001 | adj-054.1.1 | Signal buffer with critical/context classification | | US1 |
| T002 | adj-054.1.2 | Deduplication and expiry logic | | US1 |
| T003 | adj-054.1.3 | Register aggregator in AdjutantCore | | US1 |

### Phase 2: Stimulus Engine

| T-ID | Bead ID | Title | Parallel | User Story |
|------|---------|-------|----------|------------|
| T004 | adj-054.2.1 | Stimulus engine with three wake sources | | US2 |
| T005 | adj-054.2.2 | Situation prompt template + bootstrap prompt | | US2 |
| T006 | adj-054.2.3 | Replace periodic-summary with stimulus engine | | US2 |

### Phase 3: Action Tools

| T-ID | Bead ID | Title | Parallel | User Story |
|------|---------|-------|----------|------------|
| T007 | adj-054.3.1 | spawn_worker MCP tool | [P] | US3 |
| T008 | adj-054.3.2 | assign_bead MCP tool | [P] | US3 |
| T009 | adj-054.3.3 | nudge_agent MCP tool | [P] | US3 |
| T010 | adj-054.3.4 | decommission_agent + rebalance_work MCP tools | [P] | US3 |
| T011 | adj-054.3.5 | schedule_check + watch_for MCP tools | | US3 |
| T012 | adj-054.3.6 | Adjutant-only access guard for coordination tools | | US3 |

### Phase 4: Adjutant Prompt Update

| T-ID | Bead ID | Title | Parallel | User Story |
|------|---------|-------|----------|------------|
| T013 | adj-054.4.1 | Update adjutant.md with event-driven reasoning + self-scheduling | | US4 |

### Phase 5: Decision Feedback

| T-ID | Bead ID | Title | Parallel | User Story |
|------|---------|-------|----------|------------|
| T014 | adj-054.5.1 | Outcome tracking in state store | | US5 |
| T015 | adj-054.5.2 | Feedback summary in stimulus prompts | | US5 |

### Phase 6: Cleanup

| T-ID | Bead ID | Title | Parallel | User Story |
|------|---------|-------|----------|------------|
| T016 | adj-054.6.1 | Delete old behavior files + periodic-summary + dead imports | | US6 |

## Dependency Graph

```
adj-054.1.1 ──┬──→ adj-054.1.3
adj-054.1.2 ──┘
      │
      └──→ adj-054.2.1 ──→ adj-054.2.2 ──→ adj-054.2.3 ──→ adj-054.6.1
                │                │
                │                ├──→ adj-054.4.1
                │                └──→ adj-054.5.2
                │
                └──→ adj-054.3.5 ──→ adj-054.4.1

adj-054.3.1 ──→ adj-054.3.5 (schedule tools need stimulus engine)
      │
      ├──→ adj-054.3.6 (access guard needs at least one tool)
      └──→ adj-054.4.1

adj-054.3.2, adj-054.3.3, adj-054.3.4 — parallel, no cross-deps

adj-054.5.1 ──→ adj-054.5.2
```

## Ready to Start (No Blockers)

- adj-054.1.1 — Signal buffer with critical/context classification
- adj-054.1.2 — Deduplication and expiry logic
- adj-054.3.1 — spawn_worker MCP tool
- adj-054.3.2 — assign_bead MCP tool
- adj-054.3.3 — nudge_agent MCP tool
- adj-054.3.4 — decommission_agent + rebalance_work MCP tools
- adj-054.5.1 — Outcome tracking in state store
