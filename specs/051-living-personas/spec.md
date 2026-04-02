# Feature Specification: Living Personas

**Feature Branch**: `051-living-personas`
**Created**: 2026-04-01
**Status**: Accepted
**Proposal**: f4f1903d-e23e-480a-97f3-cecc82e9548d

## User Scenarios & Testing

### User Story 1 - StarCraft Lore Reference (Priority: P1)

Every StarCraft callsign has a personality reference file so agents can discover who they are.

**Why this priority**: Foundation for the genesis ritual — agents need lore to read before they can self-define.

**Independent Test**: File exists at `.claude/lore/starcraft-heroes.md` with entries for all 44 callsigns. Each entry has a personality description and suggested trait affinities.

**Acceptance Scenarios**:

1. **Given** an agent spawns with callsign "tassadar", **When** it reads `.claude/lore/starcraft-heroes.md`, **Then** it finds a Tassadar entry with personality description and suggested affinities
2. **Given** a developer checks the lore file, **When** they count entries, **Then** all 44 callsigns (15 Terran, 13 Zerg, 16 Protoss) have entries

---

### User Story 2 - Genesis Ritual on First Spawn (Priority: P0)

When an agent spawns with a callsign that has no persona, their first act is to define themselves by reading lore, reflecting on their assignment, and allocating 100 trait points.

**Why this priority**: This is the core feature — without it, agents remain personality-less.

**Independent Test**: Spawn a new callsign agent. Verify it creates a persona via create_persona MCP tool before doing any other work. Verify the persona is stored in the DB and linked to the callsign.

**Acceptance Scenarios**:

1. **Given** callsign "fenix" has no persona, **When** an agent spawns as "fenix", **Then** it receives a genesis prompt instead of the normal Layer 3 preamble
2. **Given** the genesis prompt, **When** the agent reads lore and allocates traits, **Then** it calls create_persona with exactly 100 total points across 12 traits
3. **Given** create_persona succeeds, **When** "fenix" spawns again later, **Then** the existing persona is injected (no genesis ritual)
4. **Given** the agent tries to allocate 110 points, **When** it calls create_persona, **Then** the call is rejected with a validation error

---

### User Story 3 - Persona Injection on Spawn (Priority: P0)

When an agent spawns with a callsign that already has a persona, that persona's behavioral prompt is injected automatically via the existing --agent file mechanism.

**Why this priority**: Completes the spawn-to-persona pipeline — without this, self-generated personas have no effect.

**Independent Test**: Create a persona for callsign "zeratul". Spawn an agent as "zeratul". Verify the persona prompt file is written to `.claude/agents/zeratul.md` and the agent receives it.

**Acceptance Scenarios**:

1. **Given** "zeratul" has a persona with high qa_correctness, **When** an agent spawns as "zeratul", **Then** the generated prompt emphasizes correctness and testing
2. **Given** "zeratul" spawns via spawn_worker MCP tool, **When** the coordinator provides a task prompt, **Then** the persona prompt is prepended to the task prompt
3. **Given** "zeratul" spawns via REST /api/agents/spawn, **When** no personaId is provided, **Then** the callsign persona is auto-discovered and injected

---

### User Story 4 - Persona Evolution After Retros (Priority: P2)

After session retrospectives, agents can adjust their trait weights by +/-2 per trait, allowing gradual specialization.

**Why this priority**: Enhancement — the system works without it, but evolution makes personas improve over time.

**Independent Test**: Agent calls evolve_persona after a retro. Verify traits adjust within bounds. Verify evolution is logged.

**Acceptance Scenarios**:

1. **Given** an agent has a persona with qa_correctness=10, **When** it calls evolve_persona with qa_correctness +2, **Then** the trait updates to 12 and the change is logged
2. **Given** an agent tries to adjust a trait by +5, **When** it calls evolve_persona, **Then** the call is rejected (max +/-2 per adjustment)
3. **Given** an agent evolves traits, **When** the total would exceed 100, **Then** the call is rejected (budget constraint preserved)

---

### User Story 5 - Dashboard and iOS Persona Display (Priority: P2)

Users can see agent personas, trait distributions, and evolution history in the dashboard and iOS app.

**Why this priority**: Visibility feature — the system works without it, but users want to see agent personalities.

**Independent Test**: Open agent detail on dashboard/iOS. Verify trait weights are displayed. Verify self-generated badge is shown.

**Acceptance Scenarios**:

1. **Given** an agent has a self-generated persona, **When** viewing agent detail, **Then** trait weights are displayed with the persona description
2. **Given** a persona has evolved 3 times, **When** viewing the persona gallery, **Then** the evolution history is visible
3. **Given** a persona was self-generated, **When** viewing the agent card, **Then** a "self-generated" badge appears (vs "hand-crafted" for manual personas)

---

### Edge Cases

- What happens when two agents spawn with the same callsign simultaneously? Second should get the persona created by the first (race condition guard).
- What happens if create_persona fails mid-genesis? Agent should fall back to Layer 3 preamble and retry genesis on next spawn.
- What happens if the lore file is missing? Genesis prompt should still work — agent describes themselves based on name alone.
- What if an agent exhausts the 100-point budget unevenly (e.g., 100 in one trait)? Allowed — the budget constraint is total=100, not per-trait max (that's 0-20 from existing system).

## Requirements

### Functional Requirements

- **FR-001**: System MUST check for callsign persona before every agent spawn
- **FR-002**: System MUST inject genesis prompt when no persona exists for a callsign
- **FR-003**: create_persona MCP tool MUST validate 100-point budget and 0-20 per-trait range
- **FR-004**: Personas MUST persist in the personas table with a source field ("self-generated" vs "hand-crafted")
- **FR-005**: callsign_personas junction table MUST link callsign names to persona IDs
- **FR-006**: evolve_persona MUST enforce +/-2 per adjustment and preserve 100-point budget
- **FR-007**: Genesis prompt MUST include the specific callsign's lore excerpt, not the full file

### Key Entities

- **Persona**: Existing entity (12 trait weights, name, description) — extended with `source` field
- **CallsignPersona**: New junction — maps callsign string to persona UUID
- **PersonaEvolution**: New entity — logs trait changes with before/after/timestamp

## Success Criteria

- **SC-001**: Every callsign-spawned agent gets a persona (pre-existing or self-generated within 60s)
- **SC-002**: Self-generated personas produce measurably different behavioral prompts across 5+ agents
- **SC-003**: Genesis ritual overhead under 60 seconds (does not significantly delay work start)
- **SC-004**: 100-point budget is enforced — no persona exceeds it
- **SC-005**: Persona evolution shows specialization drift after 3+ sessions
