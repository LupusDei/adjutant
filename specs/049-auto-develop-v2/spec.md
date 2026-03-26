# 049 — Auto-Develop V2: Thorough Validation, Research-Backed Ideation, Never-Idle Loop

## Overview

Comprehensive improvements to the auto-develop loop based on an 8-cycle retrospective running the auto-tank project. The current loop executes fast but has shallow validation (black screen bug passed 848 tests), surface-level ideation (no external research), and stops when it runs out of ideas instead of digging deeper. This epic addresses all three gaps plus infrastructure fixes.

## User Stories

### US1: Thorough VALIDATE Phase (Priority: P0)

**As** a product owner using auto-develop,
**I want** the VALIDATE phase to verify spec intent and end-to-end usability (not just test pass),
**So that** shipped features actually work for users and integration gaps are caught before cycling.

**Acceptance Criteria:**
- [ ] VALIDATE spawns QA Sentinel L4 agents with the epic's spec and acceptance criteria
- [ ] QA Sentinels verify the feature works as a user would experience it (run the app, check UI)
- [ ] QA Sentinels check that ALL acceptance criteria from spec.md are met
- [ ] QA Sentinels look for integration gaps — systems built but not wired together
- [ ] QA Sentinels create bug beads for anything that doesn't match spec intent
- [ ] Phase only advances when QA signs off (no new P1/P0 bugs), not just when tests pass
- [ ] If QA finds bugs, cycle goes back to EXECUTE to fix them before advancing
- [ ] The `buildValidateReason()` prompt includes spec acceptance criteria, not just "check tests"

### US2: Research-Backed IDEATE Phase (Priority: P0)

**As** a product owner using auto-develop,
**I want** the IDEATE phase to conduct external research before generating proposals,
**So that** proposals are informed by reference material, competitor analysis, and codebase gap analysis rather than just coordinator memory.

**Acceptance Criteria:**
- [ ] IDEATE can optionally spawn a Research Agent before generating proposals
- [ ] Research Agent uses WebSearch to find information about the project's inspiration (e.g., Worms wiki, Scorched Earth features)
- [ ] Research Agent analyzes the codebase for gaps between README vision and actual implementation
- [ ] Research Agent identifies refactoring opportunities, test coverage gaps, and UX improvements
- [ ] Research findings are included in the coordinator's ideation prompt as context
- [ ] Proposals generated with research context cite their sources (e.g., "from Worms Armageddon: ninja rope feature")
- [ ] Research is skipped when the user has provided enough clear vision (configurable)

### US3: Never-Idle Loop with 3-Strike Escalation (Priority: P0)

**As** a product owner using auto-develop,
**I want** the loop to never simply stop when it runs out of proposals,
**So that** the system continuously refines and improves the project from both product and engineering perspectives.

**Acceptance Criteria:**
- [ ] When IDEATE produces no proposals, the loop enters a RESEARCH sub-phase
- [ ] RESEARCH spawns agents to web-search for new ideas and analyze codebase for improvements
- [ ] If research produces low-confidence proposals (40-59), a REFINE pass runs — tighter scope, UX polish, engineering quality
- [ ] If research + refinement can't produce >60 confidence proposals, the coordinator escalates to the user via MCP message asking for vision/direction
- [ ] Escalation messages are structured: what was tried, what's exhausted, what kind of direction would help
- [ ] The coordinator tries 3 different research angles before each escalation
- [ ] After 3 unanswered escalations (user doesn't respond within configurable timeout), THEN the loop pauses
- [ ] Paused state is visible in the dashboard and can be resumed by the user providing vision
- [ ] The loop tracks escalation count in the cycle record

### US4: Proposal Completion Events (Priority: P1)

**As** a dashboard user,
**I want** to see when proposals have been fully implemented,
**So that** I can track the proposal → epic → completion lifecycle in the timeline.

**Acceptance Criteria:**
- [ ] When an epic born from a proposal is closed, a `proposal:completed` event is emitted on the EventBus
- [ ] Event payload includes: proposalId, epicId, projectId, title, summary of what was delivered
- [ ] The event appears in the timeline as a distinct event type with appropriate icon/color
- [ ] The proposal's status in the DB is auto-updated to "completed"
- [ ] iOS and frontend timeline views render the new event type

### US5: Auto-Complete Stale Proposals (Priority: P1)

**As** a coordinator managing auto-develop,
**I want** proposals to be automatically marked completed when their beads are all closed,
**So that** the REVIEW phase doesn't keep nudging about proposals that were already executed.

**Acceptance Criteria:**
- [ ] When all beads associated with a proposal are closed, the proposal status auto-updates to "completed"
- [ ] The check runs on `bead:updated` events (specifically status → closed)
- [ ] Proposals that were executed as beads but never formally linked are handled (match by title/description similarity or explicit proposal→epic link field)
- [ ] The idle-proposal-nudge behavior skips proposals in "completed" status
- [ ] No more spam from stale proposals in SITUATION reports

### US6: Parallel Agent Execution (Priority: P1)

**As** a coordinator in the EXECUTE phase,
**I want** independent epics to be assigned to separate L3 agents in parallel,
**So that** cycle time is reduced when multiple non-dependent epics exist.

**Acceptance Criteria:**
- [ ] The `buildExecuteReason()` prompt instructs the coordinator to identify independent epics
- [ ] Independent epics (no shared dependencies) are assigned to different available agents
- [ ] Dependent epics are assigned sequentially to the same agent
- [ ] The coordinator monitors all parallel agents and only advances when ALL are done
- [ ] If one agent fails/blocks, others continue — the coordinator handles the blocked one separately

### US7: Fix Empty Cycle Creation (Priority: P2)

**As** a coordinator,
**I want** the loop to not create empty cycles when there's no work to do,
**So that** I don't get spammed with endless REVIEW nudges for non-existent proposals.

**Acceptance Criteria:**
- [ ] Before creating a new cycle, the loop checks: any pending proposals? any open beads? any accepted proposals awaiting planning?
- [ ] If all answers are "no", the loop enters the never-idle research behavior (US3) instead of creating an empty cycle
- [ ] The idle-proposal-nudge behavior is auto-develop-aware — skips nudging agents on projects where auto-develop is managing the work
- [ ] Empty cycles are no longer created in the auto_develop_cycles table

### US8: Fix Cycle Counter Sync (Priority: P2)

**As** a dashboard user,
**I want** cycle counters to accurately reflect proposals generated and accepted,
**So that** I can track auto-develop productivity.

**Acceptance Criteria:**
- [ ] `proposals_generated` counts only proposals created during THIS cycle (not all-time)
- [ ] `proposals_accepted` counts only proposals accepted during THIS cycle
- [ ] Counters update in real-time as proposals are scored (not just on behavior tick)
- [ ] The `proposal:scored` event handler increments the appropriate counter
- [ ] Escalation count is tracked as a new field in the cycle record

## Success Criteria

1. A full auto-develop cycle with the improved VALIDATE phase catches integration issues that unit tests miss (like the black screen bug)
2. A full IDEATE phase with research produces proposals that reference external sources
3. The loop runs for 24+ hours without human intervention, continuously finding improvements
4. Proposal lifecycle is fully visible in the timeline: created → scored → accepted → planned → executed → completed
5. No stale proposal spam or empty cycle creation
6. Multiple agents execute independent epics in parallel, reducing cycle time by 40%+

## Non-Goals

- WebGL rendering or game-specific features (those are auto-tank concerns)
- Changing the 7-phase structure (ANALYZE→IDEATE→REVIEW→GATE→PLAN→EXECUTE→VALIDATE)
- Multi-project auto-develop (one loop per project is fine)
- Human-in-the-loop approval gates (the loop is autonomous by design)
