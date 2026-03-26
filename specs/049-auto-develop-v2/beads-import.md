# 049 — Auto-Develop V2: Beads Import

## Root Epic

| Bead ID | Type | Title | Priority |
|---------|------|-------|----------|
| adj-152 | epic | Auto-Develop V2: Thorough Validation, Research Ideation, Never-Idle Loop | P1 |

## Phase 1: Infrastructure & Types

| Bead ID | T-ID | Type | Title | Priority |
|---------|------|------|-------|----------|
| adj-152.1 | — | epic | Infrastructure & Types | P1 |
| adj-152.1.1 | T001 | task | DB migration: escalation tracking + proposal linkage | P1 |
| adj-152.1.2 | T002 | task | Event types: proposal:completed, ideate:research_complete | P1 |
| adj-152.1.3 | T003 | task | Types: IdeateSubState, EscalationState, ResearchFindings | P1 |

## Phase 2: Thorough VALIDATE (US1)

| Bead ID | T-ID | Type | Title | Priority |
|---------|------|------|-------|----------|
| adj-152.2 | — | epic | Thorough VALIDATE phase | P0 |
| adj-152.2.1 | T004 | task | Rewrite buildValidateReason() with spec acceptance criteria | P0 |
| adj-152.2.2 | T005 | task | QA Sentinel spawn prompt template | P0 |
| adj-152.2.3 | T006 | task | VALIDATE advancement gating on P0/P1 bugs | P1 |
| adj-152.2.4 | T007 | task | Tests for VALIDATE behavior | P1 |

## Phase 3: Research-Backed IDEATE (US2)

| Bead ID | T-ID | Type | Title | Priority |
|---------|------|------|-------|----------|
| adj-152.3 | — | epic | Research-backed IDEATE phase | P0 |
| adj-152.3.1 | T008 | task | buildResearchReason() with WebSearch + codebase analysis | P0 |
| adj-152.3.2 | T009 | task | Research findings → ideation context pipeline | P1 |
| adj-152.3.3 | T010 | task | Tests for research-backed ideation | P1 |

## Phase 4: Never-Idle Loop (US3)

| Bead ID | T-ID | Type | Title | Priority |
|---------|------|------|-------|----------|
| adj-152.4 | — | epic | Never-idle loop with 3-strike escalation | P0 |
| adj-152.4.1 | T011 | task | IDEATE sub-state machine | P0 |
| adj-152.4.2 | T012 | task | Escalation message builder | P1 |
| adj-152.4.3 | T013 | task | Escalation tracking in cycles + configurable timeout | P1 |
| adj-152.4.4 | T014 | task | Tests for never-idle behavior | P1 |

## Phase 5: Proposal Lifecycle (US4, US5)

| Bead ID | T-ID | Type | Title | Priority |
|---------|------|------|-------|----------|
| adj-152.5 | — | epic | Proposal lifecycle events + auto-complete | P1 |
| adj-152.5.1 | T015 | task | Emit proposal:completed on epic close | P1 |
| adj-152.5.2 | T016 | task | Auto-complete proposals when all beads closed | P1 |
| adj-152.5.3 | T017 | task | Timeline rendering for proposal:completed (frontend + iOS) | P2 |
| adj-152.5.4 | T018 | task | Tests for proposal lifecycle | P1 |

## Phase 6: Execution & Loop Fixes (US6, US7, US8)

| Bead ID | T-ID | Type | Title | Priority |
|---------|------|------|-------|----------|
| adj-152.6 | — | epic | Execution improvements + loop fixes | P1 |
| adj-152.6.1 | T019 | task | Parallel execution: dependency analysis + multi-agent | P1 |
| adj-152.6.2 | T020 | task | Empty cycle prevention | P2 |
| adj-152.6.3 | T021 | task | idle-proposal-nudge auto-develop awareness | P2 |
| adj-152.6.4 | T022 | task | Cycle counter sync fix | P2 |
| adj-152.6.5 | T023 | task | Tests for execution and loop fixes | P2 |

## Dependencies

- adj-152.1 (Infrastructure) blocks all other phases
- Phases 2-5 can run in parallel after Phase 1
- Phase 6 can run in parallel with Phases 2-5
- Incorporates existing beads: adj-149 → adj-152.6.2, adj-150 → adj-152.5.1, adj-151 → adj-152.4

## Totals

- 1 root epic
- 6 sub-epics
- 23 tasks
- Estimated: ~1500 lines production + ~800 lines tests
