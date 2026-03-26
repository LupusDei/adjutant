# 049 — Auto-Develop V2: Implementation Plan

## Architecture Decisions

### 1. VALIDATE Phase Enhancement
Modify `buildValidateReason()` in `auto-develop-loop.ts` to include the spec's acceptance criteria in the coordinator wake prompt. The coordinator then spawns QA Sentinel agents with explicit instructions to check each criterion. QA Sentinels are L4 agents (native Claude Code teammates) spawned by the squad leader with `isolation: "worktree"`.

### 2. Research Agent for IDEATE
Add a new `buildResearchReason()` helper that constructs a coordinator prompt including project vision, README content, and instructions to spawn a Research Agent. The Research Agent uses `WebSearch` to find inspiration sources and `Grep`/`Read` to analyze codebase gaps. Research findings are passed to the ideation step as context.

### 3. Never-Idle Loop State Machine
Extend the auto-develop loop with sub-states within IDEATE:
- `ideate` → normal ideation (existing behavior)
- `ideate:research` → spawn research agent for deep exploration
- `ideate:refine` → look at existing code for improvement opportunities
- `ideate:escalate` → message user for direction

Track escalation state in `auto_develop_cycles` table (new `escalation_count` column, `last_escalation_at` timestamp).

### 4. Proposal → Epic Linkage
Add a `proposal_id` column to beads (or a `proposal_epics` junction table) to track which epic was born from which proposal. When the epic is closed, look up the linked proposal and emit `proposal:completed`.

### 5. Parallel Execution Strategy
Modify `buildExecuteReason()` to analyze epic dependencies and instruct the coordinator to assign independent epics to separate agents. Use `bd show` to check if epics share any dependency chains.

## Key Files

| File | Changes |
|------|---------|
| `backend/src/services/adjutant/behaviors/auto-develop-loop.ts` | VALIDATE prompt, IDEATE research, never-idle logic, parallel execute |
| `backend/src/services/auto-develop-store.ts` | Escalation tracking, cycle counter improvements |
| `backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts` | Auto-develop awareness |
| `backend/src/services/event-bus.ts` | `proposal:completed` event type |
| `backend/src/services/mcp-tools/auto-develop.ts` | Research phase support, escalation tools |
| `backend/src/services/mcp-tools/beads.ts` | Proposal linkage on epic close |
| `backend/src/services/mcp-tools/proposals.ts` | Auto-complete logic |
| `backend/src/types/auto-develop.ts` | New phase sub-states, escalation types |
| `backend/src/services/database.ts` | Migration for escalation columns |

## Phases

### Phase 1: Infrastructure & Types (Setup)
Foundation: new DB columns, event types, shared types.

### Phase 2: Thorough VALIDATE (US1)
The highest-impact change — catches bugs like the black screen issue.

### Phase 3: Research-Backed IDEATE (US2)
Enables deeper proposal generation with external research.

### Phase 4: Never-Idle Loop (US3)
The behavioral change that keeps the loop running continuously.

### Phase 5: Proposal Lifecycle (US4, US5)
Coordinator-driven proposal completion during VALIDATE phase. The coordinator marks proposals complete after QA passes, emitting proposal:completed events. No automated bead:closed listeners (agents use bd CLI which bypasses EventBus).

### Phase 6: Execution & Loop Fixes (US6, US7, US8)
Parallel execution, empty cycle fix, counter sync.

## Parallel Opportunities

- Phase 2 (VALIDATE) and Phase 3 (IDEATE) are independent — can run in parallel
- Phase 5 (Proposal Lifecycle) is independent of Phases 2-4
- Phase 6 tasks are mostly independent of each other

## Bead Map

- `adj-152` - Root epic: Auto-Develop V2
  - `adj-152.1` - Phase 1: Infrastructure & Types
    - `adj-152.1.1` - DB migration: escalation_count, last_escalation_at on cycles + proposal_id on beads
    - `adj-152.1.2` - Event types: proposal:completed, ideate:research_complete
    - `adj-152.1.3` - Types: IdeateSubState, EscalationState, ResearchFindings
  - `adj-152.2` - Phase 2: Thorough VALIDATE (US1)
    - `adj-152.2.1` - Rewrite buildValidateReason() to include spec acceptance criteria
    - `adj-152.2.2` - QA Sentinel spawn prompt template with acceptance checklist
    - `adj-152.2.3` - VALIDATE advancement gating — only advance when no P0/P1 bugs open
    - `adj-152.2.4` - Tests for VALIDATE behavior changes
  - `adj-152.3` - Phase 3: Research-Backed IDEATE (US2)
    - `adj-152.3.1` - buildResearchReason() helper with WebSearch + codebase analysis instructions
    - `adj-152.3.2` - Research findings → ideation context pipeline
    - `adj-152.3.3` - Tests for research-backed ideation
  - `adj-152.4` - Phase 4: Never-Idle Loop (US3)
    - `adj-152.4.1` - IDEATE sub-state machine: ideate → research → refine → escalate
    - `adj-152.4.2` - Escalation message builder with structured vision requests
    - `adj-152.4.3` - 3-strike tracking in auto_develop_cycles + configurable timeout
    - `adj-152.4.4` - Tests for never-idle behavior
  - `adj-152.5` - Phase 5: Proposal Lifecycle (US4, US5)
    - `adj-152.5.1` - Emit proposal:completed on epic close with proposal linkage
    - `adj-152.5.2` - Auto-complete proposals when all linked beads are closed
    - `adj-152.5.3` - Timeline rendering for proposal:completed events (frontend + iOS)
    - `adj-152.5.4` - Tests for proposal lifecycle
  - `adj-152.6` - Phase 6: Execution & Loop Fixes (US6, US7, US8)
    - `adj-152.6.1` - Parallel execution: dependency analysis + multi-agent assignment in buildExecuteReason()
    - `adj-152.6.2` - Empty cycle prevention: check for work before creating cycle
    - `adj-152.6.3` - idle-proposal-nudge auto-develop awareness
    - `adj-152.6.4` - Cycle counter sync: per-cycle counting via proposal:scored handler
    - `adj-152.6.5` - Tests for execution and loop fixes
