# Feature Specification: Persistent Self-Correcting Memory System

**Feature Branch**: `033-persistent-memory`
**Created**: 2026-03-08
**Status**: Draft
**Related Epic**: adj-052 (The Full Adjutant)
**Supersedes**: adj-052.4.5 (Retrospective behavior from Phase 5)

## Overview

Give the Adjutant system a persistent, self-correcting memory that accumulates learnings across sessions, detects recurring mistakes, prunes stale knowledge, and proposes improvements to its own rules and agent definition. This is the missing "learn" capability identified in spec-full-vision.md.

### Current State

The Adjutant has five memory mechanisms, all with gaps:

| Mechanism | Type | Limitation |
|-----------|------|-----------|
| `MEMORY.md` | Auto-injected file | 200-line truncation, no topic files, no structure |
| `.claude/rules/` | Static repo files | Agent can't update them |
| `.claude/agents/adjutant.md` | Static definition | No learned behaviors |
| PRIME.md | Hook-injected | Static policy |
| AdjutantState SQLite | Agent profiles + decisions | No learning/pattern storage |

### Design Decisions (User-Confirmed)

1. **Dual-layer memory**: SQLite as source of truth + sync to auto-memory `.md` files
2. **Correction detection**: Message keyword heuristics (detect "don't do X", "always do Y", "remember that")
3. **Self-modification**: Proposals only — agent creates proposals via existing MCP tool, user approves
4. **Phase 5 overlap**: This epic supersedes adj-052.4.5's retrospective behavior

---

## User Scenarios & Testing

### User Story 1 - Learning from Corrections (Priority: P1)

When the user corrects the Adjutant (or any agent), the system captures the correction as a structured learning, categorizes it, and ensures it's surfaced in future sessions to prevent the same mistake.

**Why this priority**: Corrections are the highest-signal learning events. Every correction that gets lost is a wasted teaching moment.

**Independent Test**: Send a message containing "always use worktree isolation when spawning agents." Verify a learning entry is created in SQLite with category=operational, topic=worktree-isolation, confidence=0.5. On next startup review, verify it appears in the top lessons list.

**Acceptance Scenarios**:

1. **Given** a user sends a message containing "don't do X" or "always do Y", **When** the memory-collector processes the mail:received event, **Then** a learning entry is created with source_type=user_correction and appropriate category/topic
2. **Given** the same correction pattern appears 3 times across sessions, **When** the memory-reviewer runs, **Then** the learning's confidence score increases and it's flagged as a high-priority recurring issue
3. **Given** a learning exists for mistake X, **When** the same mistake recurs (detected via similar correction message), **Then** the correction's recurrence_count increments and the learning is flagged for review

---

### User Story 2 - Session Retrospectives (Priority: P1)

At the end of each day (or on-demand), the system generates a structured retrospective summarizing what happened, what went well, what didn't, and what to change. Retrospectives are persisted and reviewable.

**Why this priority**: Without retrospectives, there's no structured reflection. The system can't improve what it can't measure.

**Independent Test**: After a session with 3 beads closed and 1 correction received, trigger the retrospective behavior. Verify a row in adjutant_retrospectives with correct metrics and non-empty went_well/went_wrong/action_items.

**Acceptance Scenarios**:

1. **Given** a day's work with N beads closed, M corrections, **When** the daily retrospective runs, **Then** a structured retro is written with accurate metrics and actionable insights
2. **Given** 5 retrospectives exist, **When** the memory-reviewer runs at startup, **Then** it surfaces the top recurring themes from recent retros

---

### User Story 3 - Startup Memory Review (Priority: P1)

At the start of each session, the Adjutant reviews its most important recent learnings and surfaces them to the agent context. High-confidence learnings get injected into the heartbeat prompt.

**Why this priority**: Learnings are useless if they're not present when decisions are made.

**Independent Test**: Create 5 learnings with varying confidence scores. Trigger the startup review. Verify the top 3 (by confidence * recency) are included in the next heartbeat prompt.

**Acceptance Scenarios**:

1. **Given** 10 learnings exist with varying confidence, **When** the Adjutant agent starts a new session, **Then** the memory-reviewer surfaces the top 5 most relevant learnings
2. **Given** a learning has confidence > 0.8 and was applied successfully 3+ times, **When** memory file sync runs, **Then** it's written to the appropriate auto-memory topic file

---

### User Story 4 - Self-Improvement Proposals (Priority: P2)

After accumulating enough learnings, the system analyzes patterns and creates proposals for improving its own rules, agent definition, or workflow policies.

**Why this priority**: This is the meta-learning loop. Lower priority than capture/review because it requires a foundation of accumulated learnings.

**Independent Test**: Create 5 learnings in category=operational about the same topic (e.g., "worktree-isolation"). Trigger the self-improver. Verify it creates a proposal via the MCP create_proposal tool suggesting a rule update.

**Acceptance Scenarios**:

1. **Given** 5+ learnings exist on the same topic with high confidence, **When** the self-improver runs, **Then** a proposal is created suggesting a rule or agent definition update
2. **Given** a proposal was previously accepted, **When** the self-improver runs again, **Then** it tracks the acceptance as a positive meta-learning signal

---

### User Story 5 - Memory Query API (Priority: P2)

The Adjutant agent (and the dashboard) can query memories by category, topic, confidence, and recency. This enables the agent to self-serve context during heartbeat prompts.

**Why this priority**: Without a query interface, the memory is write-only. The agent needs to read its own memories to use them.

**Independent Test**: Insert 10 learnings across 3 categories. Query with category=technical, minConfidence=0.6. Verify only matching entries are returned, sorted by relevance.

**Acceptance Scenarios**:

1. **Given** N learnings in the database, **When** an MCP tool call queries by category and minConfidence, **Then** matching entries are returned sorted by confidence * recency
2. **Given** a topic search for "worktree", **When** FTS query executes, **Then** all learnings mentioning "worktree" in content or topic are returned

---

### Edge Cases

- What happens when two corrections contradict each other? → The newer correction supersedes the older one (via `superseded_by` FK). Both are preserved for audit.
- What happens when MEMORY.md hits 200 lines? → Memory file sync creates topic sub-files and keeps MEMORY.md as a concise index.
- What happens when a learning is applied but the mistake recurs? → The correction tracking system increments `recurrence_count` and flags it for human review.
- What happens when the SQLite database is reset? → Learnings in auto-memory files serve as a partial backup. The memory-reviewer can re-import from them.

## Requirements

### Functional Requirements

- **FR-001**: System MUST persist learnings in SQLite with category, topic, confidence, and source tracking
- **FR-002**: System MUST detect user corrections from message patterns (heuristic keywords)
- **FR-003**: System MUST generate daily session retrospectives with metrics
- **FR-004**: System MUST surface top learnings at startup via the heartbeat/review cycle
- **FR-005**: System MUST sync high-confidence learnings to auto-memory `.md` files
- **FR-006**: System MUST support full-text search across learnings (FTS5)
- **FR-007**: System MUST create self-improvement proposals via existing proposal MCP tool
- **FR-008**: System MUST track correction-to-learning-to-outcome feedback chains
- **FR-009**: System MUST prune stale/low-confidence learnings weekly
- **FR-010**: System MUST NOT modify `.claude/rules/` or `.claude/agents/` directly — proposals only

### Key Entities

- **Learning**: A piece of knowledge captured from a correction, observation, or pattern. Has category, topic, confidence, reinforcement count, and source reference.
- **Retrospective**: A structured summary of a session/day's work. Has metrics (beads closed, corrections, agents used) and reflection (went well, went wrong, action items).
- **Correction**: A tracked instance of a user teaching the system. Links to source message and resulting learning. Tracks recurrence to measure effectiveness.

## Success Criteria

- **SC-001**: After 10 sessions with corrections, at least 80% of corrections have corresponding learnings in SQLite
- **SC-002**: Recurring mistakes (same correction 3+ times) are flagged within 24 hours
- **SC-003**: Startup review surfaces relevant learnings within 60 seconds of session start
- **SC-004**: Self-improvement proposals are generated after 5+ learnings accumulate on the same topic
- **SC-005**: MEMORY.md stays under 200 lines with topic files used for overflow
- **SC-006**: All existing behaviors continue to function — zero regression
