# Beads Import: Per-Project Proposal Style Guide (adj-201)

## Root Epic

| Bead | Title | Type | Priority |
|---|---|---|---|
| adj-201 | Per-project proposal style guide (brand color) + dark/accessible/friendly proposal-page baseline | epic | 1 |

## Sub-Epics (Phases)

| Bead | Phase | Title | Type | Depends on |
|---|---|---|---|---|
| adj-201.1 | 1 | Foundational — backend data model + REST routes | epic | adj-201 |
| adj-201.2 | 2 | US1 — Web project-page brand-color editor | epic | adj-201.1 |
| adj-201.3 | 3 | US2 — MCP get_project_style + authoring contract | epic | adj-201.1 |
| adj-201.4 | 4 | US3 — Composition baseline: dark/accessible/friendly | epic | adj-201 |
| adj-201.5 | 5 | US4 — iOS project-page brand-color editor | epic | adj-201.1 |
| adj-201.6 | 6 | US5 — QA drift-lint + authoring guideline docs | epic | adj-201.3, adj-201.4 |

## Tasks

| T-ID | Bead | Title | Type | [P] | Depends on |
|---|---|---|---|---|---|
| T001 | adj-201.1.1 | Migration 036 — brand_color columns on projects | task | | adj-201.1 |
| T002 | adj-201.1.2 | Style-guide service get/set + Project mapping (TDD) | task | | adj-201.1.1 |
| T003 | adj-201.1.3 | REST GET/PUT /:id/style-guide (TDD) | task | | adj-201.1.2 |
| T004 | adj-201.2.1 | api client + useProjectStyleGuide hook (TDD) | task | P | adj-201.1.3 |
| T005 | adj-201.2.2 | StyleGuideEditor component (TDD) | task | | adj-201.2.1 |
| T006 | adj-201.3.1 | get_project_style MCP tool (TDD) | task | P | adj-201.1.2 |
| T007 | adj-201.3.2 | create/revise_proposal authoring-contract description updates | task | | adj-201.3.1 |
| T008 | adj-201.4.1 | composeProposalDocument dark/accessible/friendly baseline (TDD) | task | P | adj-201.4 |
| T009 | adj-201.5.1 | iOS Project model + AdjutantKit API style-guide (TDD) | task | P | adj-201.1.3 |
| T010 | adj-201.5.2 | iOS SwarmProjectDetailView style-guide editor (TDD) | task | | adj-201.5.1 |
| T011 | adj-201.6.1 | proposal-style-lint drift-lint (TDD) | task | P | adj-201.3.1, adj-201.4.1 |
| T012 | adj-201.6.2 | Authoring guideline doc + rule/CLAUDE/CHANGELOG updates | task | | adj-201.6.1 |

## Notes
- adj-201.4 (composition baseline) depends only on the root — start immediately, parallel to Phase 1.
- After adj-201.1 merges, Phases 2 / 3 / 5 run in parallel (web / MCP / iOS — disjoint files).
- adj-201.6 starts once 201.3.1 + 201.4.1 land.
