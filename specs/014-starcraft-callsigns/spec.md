# Feature Specification: StarCraft Callsign System for Agent Spawning

**Feature Branch**: `014-starcraft-callsigns`
**Created**: 2026-02-23
**Status**: Draft
**Input**: User description: "Add StarCraft/StarCraft 2 hero names as random callsigns when spawning agents. When a new agent spawns without a name, randomly pick from a roster of 44 heroes across all three races. If the name is taken, pick another. On iOS, long-pressing the Start Agent button presents a picker to choose a specific callsign."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Random Callsign on Agent Spawn (Priority: P1)

The Mayor spawns a new agent from the dashboard or iOS app without specifying a name. The system automatically assigns a memorable StarCraft hero callsign (e.g., "zeratul", "nova", "abathur") from a roster of 44 names spanning Terran, Zerg, and Protoss races. The agent appears in the crew list and chat with this callsign as its identity. If the randomly chosen name is already in use by an active agent, the system picks a different available name.

**Why this priority**: This is the core feature — every agent spawn benefits from a meaningful name instead of generic "agent-1" or "adjutant-agent". Without this, the feature delivers no value.

**Independent Test**: Spawn an agent without a name field. Verify the response contains a StarCraft callsign. Spawn a second agent and verify it gets a different callsign.

**Acceptance Scenarios**:

1. **Given** no active agents, **When** the Mayor spawns a new agent without specifying a name, **Then** the agent receives a random StarCraft hero callsign from the 44-name roster.
2. **Given** an active agent named "raynor", **When** the Mayor spawns another agent without a name, **Then** the new agent receives a different callsign (not "raynor").
3. **Given** all 44 callsigns are in use by active agents, **When** the Mayor spawns another agent, **Then** the system falls back to the default naming pattern and the spawn succeeds.

---

### User Story 2 - Choose Callsign via iOS Long-Press (Priority: P1)

The Mayor long-presses (0.5 seconds) the "START AGENT" button on iOS. A themed picker appears showing all 44 StarCraft callsigns organized by race (Terran, Zerg, Protoss) with filter tabs. Available callsigns are selectable; callsigns already in use by active agents are visually dimmed and non-tappable. The Mayor selects an available callsign, and the agent spawns with that specific name.

**Why this priority**: Equal priority with US1 — the iOS app is a primary interface for the Mayor. Long-press for name selection is the explicit user requirement.

**Independent Test**: On iOS, long-press the START AGENT button. Verify the picker appears with race-grouped callsigns. Select an available name. Verify the agent spawns with that exact callsign.

**Acceptance Scenarios**:

1. **Given** the iOS project detail screen with an active project, **When** the Mayor long-presses the START AGENT button for 0.5 seconds, **Then** a callsign picker sheet appears showing all 44 names grouped by race.
2. **Given** the callsign picker is open with "artanis" already in use, **When** the Mayor views the Protoss section, **Then** "artanis" appears dimmed and cannot be tapped, while other Protoss names are selectable.
3. **Given** the callsign picker is open, **When** the Mayor taps an available callsign "zeratul", **Then** the picker dismisses, a new agent spawns with the name "zeratul", and the agent appears in the crew list.
4. **Given** the callsign picker is open, **When** another agent claims "nova" between the picker loading and the Mayor tapping it, **Then** the system shows an error and refreshes the available names.

---

### User Story 3 - Callsign Names for Swarm Agents (Priority: P2)

The Mayor creates a swarm of 3 agents. Instead of receiving generic names like "agent-1", "agent-2", "agent-3", each swarm agent receives a unique StarCraft callsign. The coordinator and other agents all get distinct callsigns from the roster.

**Why this priority**: Extends the callsign system to the swarm workflow. Important for consistency but swarms are used less frequently than single agent spawns.

**Independent Test**: Create a swarm of 3 agents without a baseName. Verify all 3 agents receive distinct StarCraft callsigns.

**Acceptance Scenarios**:

1. **Given** no active agents, **When** the Mayor creates a 3-agent swarm without a custom base name, **Then** all 3 agents receive unique StarCraft callsigns.
2. **Given** a swarm is created with an explicit baseName of "builder", **When** the swarm is created, **Then** agents use the traditional pattern ("builder-1", "builder-2") instead of callsigns.
3. **Given** 42 callsigns are in use, **When** the Mayor creates a 5-agent swarm, **Then** the first 2 agents get callsigns and the remaining 3 fall back to numbered names.

---

### User Story 4 - Browse Available Callsigns (Priority: P3)

The system provides an endpoint to list all callsigns with their current availability status and race. The iOS picker and any future dashboard UI can query this to show which names are free.

**Why this priority**: Supporting endpoint for US2. Lower priority because it exists to serve the picker, not as standalone functionality.

**Independent Test**: Query the callsign list. Verify response contains 44 entries with name, race, and available fields. Spawn an agent named "raynor", re-query, verify "raynor" shows as unavailable.

**Acceptance Scenarios**:

1. **Given** no active agents, **When** querying the callsign list, **Then** all 44 names return with available status.
2. **Given** an active agent named "zagara", **When** querying the callsign list, **Then** "zagara" shows as unavailable and all others show as available.
3. **Given** an agent named "fenix" goes offline, **When** querying the callsign list, **Then** "fenix" shows as available again.

---

### Edge Cases

- What happens when an explicitly provided name conflicts with an active agent? The system rejects with a conflict error, and the caller must choose a different name.
- What happens when the iOS picker loads but the user takes a long time to choose? Between loading and selection, names may become unavailable. The system handles this with a server-side conflict check and shows a user-friendly error.
- What happens when multiple agents spawn simultaneously and pick the same random callsign? The tmux session name uniqueness check prevents duplicates — the second spawn gets a different name.
- What happens with agent name persistence across backend restarts? Session names are persisted to disk. On restart, dead sessions are pruned and their callsigns become available.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST maintain a roster of 44 StarCraft hero callsigns spanning Terran (15), Zerg (13), and Protoss (16) races.
- **FR-002**: System MUST randomly assign an available callsign when an agent is spawned without an explicit name.
- **FR-003**: System MUST NOT assign a callsign that is already in use by an active agent.
- **FR-004**: System MUST fall back to the default naming pattern when all callsigns are in use.
- **FR-005**: System MUST provide a way to list all callsigns with their race and current availability.
- **FR-006**: System MUST reject agent creation with a conflict error when an explicitly provided name matches an active agent.
- **FR-007**: System MUST release a callsign when the associated agent goes offline or is removed.
- **FR-008**: System MUST assign unique callsigns to swarm agents when no custom base name is provided.
- **FR-009**: iOS MUST present a callsign picker on long-press (0.5s) of the START AGENT button.
- **FR-010**: The callsign picker MUST show names grouped by race with availability indicators.
- **FR-011**: The callsign picker MUST prevent selection of unavailable callsigns.
- **FR-012**: All callsigns MUST be safe for use as system identifiers (lowercase alphanumeric only).

### Key Entities

- **Callsign**: A StarCraft hero name with an associated race (terran/zerg/protoss). Availability is derived at query time from active sessions, not stored separately.
- **Callsign Roster**: The static list of 44 hero names. Immutable. Serves as the source of all possible agent callsigns.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of agents spawned without an explicit name receive a StarCraft callsign (when names are available).
- **SC-002**: No two active agents share the same callsign at any point in time.
- **SC-003**: The callsign picker on iOS loads available names within 1 second of the long-press gesture.
- **SC-004**: The system gracefully handles name exhaustion — agent spawning never fails solely because callsigns are unavailable.

## Assumptions

- The 44-name roster is sufficient for practical use. Running more than 44 simultaneous agents is an extreme edge case.
- All callsign names are lowercase single words, requiring no special character handling.
- The race field is metadata for UI grouping only and does not affect agent behavior.
- Normal tap on START AGENT continues to work as before (spawns with random backend-assigned name).
