# Feature Specification: Agent Personas & Roles

**Feature Branch**: `029-agent-personas`
**Created**: 2026-03-03
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Persona CRUD & Point Budget (Priority: P1, MVP)

A user defines a named agent persona (e.g., "Sentinel" — a QA-focused agent) by allocating trait points across personality dimensions. The point-budget system enforces specialization: you get 100 total points to distribute across 12 traits (each 0–20), so maxing architecture focus means sacrificing QA or testing depth. Personas are named, described, and reusable across agent spawns.

**Why this priority**: Foundation — nothing else works without the data model and API.

**Independent Test**: Create, read, update, delete personas via REST API. Verify point budget validation rejects over-budget allocations.

**Acceptance Scenarios**:

1. **Given** no personas exist, **When** I POST a valid persona with traits summing ≤ 100, **Then** it's created with a unique ID, name, and all trait values stored
2. **Given** a persona exists, **When** I PUT updated trait values exceeding the budget (sum > 100), **Then** a 400 error with budget details is returned
3. **Given** a persona exists, **When** I GET /api/personas/:id, **Then** all trait values, metadata, and point budget usage are returned
4. **Given** a persona "Sentinel", **When** I DELETE /api/personas/:id, **Then** it's removed and no longer returned in listings
5. **Given** two personas, **When** I try to create a third with a duplicate name, **Then** a 409 conflict error is returned

---

### User Story 2 - Prompt Generation Engine (Priority: P1)

The system translates a persona's trait configuration into a contextual system prompt. High "architecture focus" produces instructions about system design, modularity, and technical debt avoidance. High "QA correctness" produces instructions about thorough testing, edge case coverage, and verification. The prompt is deterministic for a given trait set.

**Why this priority**: Core value — traits are meaningless without behavioral prompt output.

**Independent Test**: Given known trait values, the generated prompt contains expected behavioral instructions. Changing a single trait alters the corresponding prompt section.

**Acceptance Scenarios**:

1. **Given** a persona with architecture_focus=18 (high), **When** prompt is generated, **Then** it contains strong instructions about system design, dependency management, and modular architecture
2. **Given** a persona with qa_correctness=5 (low), **When** prompt is generated, **Then** QA instructions are minimal or absent
3. **Given** two personas with identical traits, **When** prompts are generated, **Then** they produce identical output
4. **Given** a trait at 0 (disabled), **When** prompt is generated, **Then** that dimension is not mentioned at all

---

### User Story 3 - Spawn & Hook Integration (Priority: P1)

When spawning an agent with a persona assigned, the persona prompt is injected into the spawn command. Additionally, SessionStart and PreCompact hooks are registered so the persona context survives context window compression.

**Why this priority**: Without injection, personas are just data with no effect.

**Independent Test**: Spawn an agent with a persona. Verify the tmux session received the persona prompt. Trigger compaction and verify the persona prompt is re-injected.

**Acceptance Scenarios**:

1. **Given** persona "Sentinel" assigned to callsign "zeratul", **When** agent is spawned via POST /api/agents/spawn with personaId, **Then** the tmux session's initial prompt includes the full persona system prompt
2. **Given** a running agent with a persona, **When** compaction occurs (PreCompact hook fires), **Then** the persona prompt is re-injected into the session
3. **Given** an agent spawned without a persona, **When** it runs, **Then** no persona prompt is injected (backward compatible)
4. **Given** persona "Sentinel" updated while agent "zeratul" runs, **When** next compaction occurs, **Then** the latest persona prompt is fetched and injected

---

### User Story 4 - iOS Persona Management UI (Priority: P2)

Personas appear as **spawnable roster entries** on the iOS Agents page — like a team on standby. Each persona shows its name, description, and trait summary. Tap one to spawn it immediately with the persona prompt auto-injected and the persona name used as callsign. A "Build Persona" button opens the editor for creating new personas. The page also includes StarCraft callsign roster toggles — individual on/off per callsign and a master toggle to disable all.

**Why this priority**: Primary user-facing interface per user preference (iOS first).

**Independent Test**: Create a persona via iOS Agents page, verify it appears in the API. Toggle callsigns, verify disabled ones aren't auto-assigned.

**Acceptance Scenarios**:

1. **Given** the iOS Agents page, **When** I view it, **Then** I see defined personas as roster entries (standby state) alongside any running agents
2. **Given** a persona "Sentinel" in the roster, **When** I tap it, **Then** an agent spawns immediately with the Sentinel persona prompt injected and "Sentinel" as its callsign
3. **Given** the iOS Agents page, **When** I tap "Build Persona", **Then** I see a form with named sliders for each trait and a visual budget indicator
4. **Given** 10 points remaining in budget, **When** I try to increase a trait by 15, **Then** the slider stops at the budget limit
5. **Given** the callsign roster section, **When** I toggle "zeratul" off, **Then** that callsign won't be auto-assigned on future spawns
6. **Given** the master callsign toggle, **When** I disable all, **Then** all StarCraft callsigns are disabled and agents must be named manually or use persona names

---

### User Story 5 - Web Dashboard Persona Management (Priority: P3)

The web dashboard provides equivalent persona management with the retro terminal theme. Slider controls, budget visualization, and full CRUD.

**Why this priority**: Web follows iOS per user direction.

**Acceptance Scenarios**:

1. **Given** the web dashboard, **When** I navigate to Personas, **Then** I see a list of defined personas with trait summaries
2. **Given** the persona editor, **When** I adjust sliders, **Then** the budget bar updates in real-time
3. **Given** a persona, **When** I click "Preview Prompt", **Then** I see the full generated system prompt

---

### Edge Cases

- What happens when a persona is deleted while an agent using it is running? Agent continues with existing prompt — no disruption
- What happens when trait definitions change in a future version? Existing personas retain values; new traits default to 0
- Can two personas have the same name? No — names must be unique (409 on conflict)
- What if a persona has 0 points allocated? Valid — generates a minimal/generic prompt
- What if the budget is exceeded by exactly 1 point? Rejected — strict enforcement

## Requirements

### Functional Requirements

- **FR-001**: System MUST store personas in SQLite with full CRUD operations
- **FR-002**: System MUST enforce a point budget (sum of all traits ≤ 100, each trait 0–20)
- **FR-003**: System MUST generate deterministic behavioral prompts from trait configurations
- **FR-004**: System MUST inject persona prompts at agent spawn time via tmux
- **FR-005**: System MUST register hooks for persona context survival across compaction
- **FR-006**: Persona names MUST be unique (case-insensitive)
- **FR-007**: iOS MUST provide persona management via "Build Persona" button on Agents page (not a separate tab)
- **FR-008**: Web dashboard MUST provide equivalent persona management UI
- **FR-009**: System MUST support enabling/disabling individual StarCraft callsigns
- **FR-010**: System MUST support a master toggle to disable all StarCraft callsigns at once
- **FR-011**: Disabled callsigns MUST be excluded from auto-assignment during agent spawn

### Key Entities

- **Persona**: Named configuration — id (UUID), name (unique), description, trait values (12 dimensions), createdAt, updatedAt
- **PersonaTrait**: Defined dimension — key (enum), label, description, min=0, max=20, prompt template
- **PointBudget**: Total=100, per-trait max=20, validation on create/update

### Trait Dimensions

| Key | Label | Description |
|-----|-------|-------------|
| `architecture_focus` | Architecture Focus | System design, dependency management, clean abstractions |
| `product_design` | Product Design | Product thinking, user needs, feature completeness |
| `uiux_focus` | UI/UX Focus | Visual design, interaction patterns, accessibility |
| `qa_scalability` | QA: Scalability | Performance testing, load handling, scaling concerns |
| `qa_correctness` | QA: Correctness | Functional correctness, edge cases, "does everything work" |
| `testing_unit` | Testing: Unit | Unit test rigor, TDD discipline, mock strategies |
| `testing_acceptance` | Testing: Acceptance | Integration/E2E test coverage, acceptance criteria |
| `modular_architecture` | Modular Architecture | Separation of concerns, clean interfaces, composability |
| `business_objectives` | Business Objectives | Business value alignment, ROI thinking, prioritization |
| `technical_depth` | Technical Depth | Low-level knowledge, performance optimization, algorithms |
| `code_review` | Code Review | Review thoroughness, attention to detail, mentoring |
| `documentation` | Documentation | Code comments, README, API docs, inline documentation |

## Success Criteria

- **SC-001**: Creating a persona and spawning an agent with it produces measurably different behavior vs. no persona
- **SC-002**: Point budget prevents "jack of all trades" personas (validation enforced server-side)
- **SC-003**: Persona prompts survive compaction (verified via hook re-injection)
- **SC-004**: iOS persona editor correctly enforces budget limits with visual feedback
