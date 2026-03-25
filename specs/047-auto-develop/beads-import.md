# Beads Import: Auto-Develop

**Root Epic**: `adj-122`
**Priority**: P1 (priority=1)

## Hierarchy

### Root Epic
| Bead ID | Type | Title | Priority |
|---------|------|-------|----------|
| `adj-122` | epic | Auto-Develop: Continuous Autonomous Project Development Loop | 1 |

### Sub-Epics
| Bead ID | Type | Title | Priority | Parent |
|---------|------|-------|----------|--------|
| `adj-122.1` | epic | Setup: Schema & Data Layer | 1 | `adj-122` |
| `adj-122.2` | epic | Foundational: Events & Types | 1 | `adj-122` |
| `adj-122.3` | epic | US2: Confidence Scoring Engine | 1 | `adj-122` |
| `adj-122.4` | epic | US3: Auto-Develop Loop Behavior | 1 | `adj-122` |
| `adj-122.5` | epic | US1+US4: Toggle & Escalation | 1 | `adj-122` |
| `adj-122.6` | epic | US7: Query Tools & REST API | 2 | `adj-122` |
| `adj-122.7` | epic | US6: Dashboard UI | 2 | `adj-122` |
| `adj-122.8` | epic | US5: iOS App | 2 | `adj-122` |

### Tasks

#### Phase 1: Schema & Data Layer (`adj-122.1`)
| Bead ID | T-ID | Type | Title | Priority |
|---------|------|------|-------|----------|
| `adj-122.1.1` | T001 | task | Migration: projects table auto-develop columns | 1 |
| `adj-122.1.2` | T002 | task | Migration: proposals table confidence columns | 1 |
| `adj-122.1.3` | T003 | task | Migration: auto_develop_cycles table | 1 |
| `adj-122.1.4` | T004 | task | Extend ProjectsService with auto-develop methods | 1 |
| `adj-122.1.5` | T005 | task | Extend ProposalStore with confidence methods | 1 |
| `adj-122.1.6` | T006 | task | Create AutoDevelopStore for cycle tracking | 1 |

#### Phase 2: Events & Types (`adj-122.2`)
| Bead ID | T-ID | Type | Title | Priority |
|---------|------|------|-------|----------|
| `adj-122.2.1` | T007 | task | Add auto-develop EventBus event types | 1 |
| `adj-122.2.2` | T008 | task | Add shared types (ConfidenceSignals, AutoDevelopPhase, etc.) | 1 |
| `adj-122.2.3` | T009 | task | Add Zod schemas for auto-develop API inputs | 1 |

#### Phase 3: Confidence Scoring Engine (`adj-122.3`)
| Bead ID | T-ID | Type | Title | Priority |
|---------|------|------|-------|----------|
| `adj-122.3.1` | T010 | task | Implement confidence score computation + classification | 1 |
| `adj-122.3.2` | T011 | task | Implement historical success rate lookup | 1 |
| `adj-122.3.3` | T012 | task | Implement score_proposal MCP tool | 1 |

#### Phase 4: Auto-Develop Loop Behavior (`adj-122.4`)
| Bead ID | T-ID | Type | Title | Priority |
|---------|------|------|-------|----------|
| `adj-122.4.1` | T013 | task | Auto-develop-loop behavior skeleton + registration | 1 |
| `adj-122.4.2` | T014 | task | Implement ANALYZE + IDEATE phases | 1 |
| `adj-122.4.3` | T015 | task | Implement REVIEW + GATE phases | 1 |
| `adj-122.4.4` | T016 | task | Implement PLAN + EXECUTE + VALIDATE phases | 1 |
| `adj-122.4.5` | T017 | task | Implement concurrency controls + backpressure | 1 |

#### Phase 5: Toggle & Escalation (`adj-122.5`)
| Bead ID | T-ID | Type | Title | Priority |
|---------|------|------|-------|----------|
| `adj-122.5.1` | T019 | task | REST endpoint for auto-develop toggle | 1 |
| `adj-122.5.2` | T020 | task | MCP tools: enable/disable auto-develop | 1 |
| `adj-122.5.3` | T021 | task | Vision update flow (provide_vision_update + projects.vision_context) | 1 |
| `adj-122.5.4` | T022 | task | Escalation message builder + APNS integration | 1 |

#### Phase 6: Query Tools & REST API (`adj-122.6`)
| Bead ID | T-ID | Type | Title | Priority |
|---------|------|------|-------|----------|
| `adj-122.6.1` | T024 | task | MCP tool: get_auto_develop_status | 2 |
| `adj-122.6.2` | T025 | task | REST: GET /api/projects/:id/auto-develop | 2 |

#### Phase 7: Dashboard UI (`adj-122.7`)
| Bead ID | T-ID | Type | Title | Priority |
|---------|------|------|-------|----------|
| `adj-122.7.1` | T026 | task | Auto-develop toggle + status indicator in project settings | 2 |
| `adj-122.7.2` | T027 | task | AutoDevelopPanel component (phase, pipeline, confidence bars) | 2 |
| `adj-122.7.3` | T028 | task | EscalationBanner component with inline vision update | 2 |
| `adj-122.7.4` | T029 | task | CycleHistory timeline component | 2 |

#### Phase 8: iOS App (`adj-122.8`)
| Bead ID | T-ID | Type | Title | Priority |
|---------|------|------|-------|----------|
| `adj-122.8.1` | T030 | task | Project detail auto-develop toggle + API integration | 2 |
| `adj-122.8.2` | T031 | task | AutoDevelopStatusView (SwiftUI) | 2 |
| `adj-122.8.3` | T032 | task | EscalationBannerView with inline response | 2 |
| `adj-122.8.4` | T033 | task | APNS notification handling for auto-develop events | 2 |

## Dependency Wiring

```bash
# Root depends on all sub-epics
bd dep add adj-122 adj-122.1
bd dep add adj-122 adj-122.2
bd dep add adj-122 adj-122.3
bd dep add adj-122 adj-122.4
bd dep add adj-122 adj-122.5
bd dep add adj-122 adj-122.6
bd dep add adj-122 adj-122.7
bd dep add adj-122 adj-122.8

# Phase 1 tasks
bd dep add adj-122.1 adj-122.1.1
bd dep add adj-122.1 adj-122.1.2
bd dep add adj-122.1 adj-122.1.3
bd dep add adj-122.1 adj-122.1.4
bd dep add adj-122.1 adj-122.1.5
bd dep add adj-122.1 adj-122.1.6

# Phase 2 tasks
bd dep add adj-122.2 adj-122.2.1
bd dep add adj-122.2 adj-122.2.2
bd dep add adj-122.2 adj-122.2.3

# Phase 3 tasks
bd dep add adj-122.3 adj-122.3.1
bd dep add adj-122.3 adj-122.3.2
bd dep add adj-122.3 adj-122.3.3

# Phase 4 tasks
bd dep add adj-122.4 adj-122.4.1
bd dep add adj-122.4 adj-122.4.2
bd dep add adj-122.4 adj-122.4.3
bd dep add adj-122.4 adj-122.4.4
bd dep add adj-122.4 adj-122.4.5

# Phase 5 tasks
bd dep add adj-122.5 adj-122.5.1
bd dep add adj-122.5 adj-122.5.2
bd dep add adj-122.5 adj-122.5.3
bd dep add adj-122.5 adj-122.5.4

# Phase 6 tasks
bd dep add adj-122.6 adj-122.6.1
bd dep add adj-122.6 adj-122.6.2

# Phase 7 tasks
bd dep add adj-122.7 adj-122.7.1
bd dep add adj-122.7 adj-122.7.2
bd dep add adj-122.7 adj-122.7.3
bd dep add adj-122.7 adj-122.7.4

# Phase 8 tasks
bd dep add adj-122.8 adj-122.8.1
bd dep add adj-122.8 adj-122.8.2
bd dep add adj-122.8 adj-122.8.3
bd dep add adj-122.8 adj-122.8.4

# Cross-phase dependencies (phases that block other phases)
# Phase 3 depends on Phase 1 + Phase 2
bd dep add adj-122.3 adj-122.1
bd dep add adj-122.3 adj-122.2

# Phase 4 depends on Phase 2 + Phase 3
bd dep add adj-122.4 adj-122.2
bd dep add adj-122.4 adj-122.3

# Phase 5 depends on Phase 1 + Phase 2
bd dep add adj-122.5 adj-122.1
bd dep add adj-122.5 adj-122.2

# Phase 6 depends on Phase 4 + Phase 5
bd dep add adj-122.6 adj-122.4
bd dep add adj-122.6 adj-122.5

# Phase 7 + 8 depend on Phase 6
bd dep add adj-122.7 adj-122.6
bd dep add adj-122.8 adj-122.6
```
