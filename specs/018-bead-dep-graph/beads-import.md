# Bead Dependency Visualization Graph - Beads

**Feature**: 018-bead-dep-graph
**Generated**: 2026-02-24
**Source**: specs/018-bead-dep-graph/tasks.md

## Root Epic

- **Title**: Bead Dependency Visualization Graph
- **Type**: epic
- **Priority**: 1
- **Description**: Add an interactive dependency graph view to the Beads tab (web and iOS) that visualizes bead hierarchies as a DAG with status color coding, critical path highlighting, and click-to-detail interaction.

## Epics

### Phase 1: Backend Graph API
- **Type**: epic
- **Priority**: 1
- **Description**: Expose bead dependency graph data via a single efficient GET /api/beads/graph endpoint that extracts dependencies from bd list output.
- **Blocks**: Phase 2, Phase 4, Phase 5
- **MVP**: true
- **Tasks**: 5

### Phase 2: Web Graph Rendering (US1)
- **Type**: epic
- **Priority**: 1
- **Description**: Render beads as a top-to-bottom DAG using React Flow v12 with dagre layout, Pip-Boy status color coding, pan/zoom, and view toggle in Beads tab.
- **Depends**: Phase 1
- **Blocks**: Phase 3, Phase 4
- **MVP**: true
- **Tasks**: 9

### Phase 3: Web Graph Interactions (US2)
- **Type**: epic
- **Priority**: 2
- **Description**: Add click-to-detail panel with agent assignment, collapse/expand sub-trees, epic filter, and edge hover tooltips.
- **Depends**: Phase 2
- **Blocks**: Phase 6
- **Tasks**: 6

### Phase 4: Web Critical Path (US3)
- **Type**: epic
- **Priority**: 3
- **Description**: Compute and visually highlight the longest chain of open dependencies from root epic to leaf tasks.
- **Depends**: Phase 2
- **Blocks**: Phase 6
- **Tasks**: 4

### Phase 5: iOS Graph View (US4)
- **Type**: epic
- **Priority**: 4
- **Description**: Implement dependency graph on iOS using ZStack hybrid approach (Canvas edges, SwiftUI CRTCard nodes) with pinch-zoom and tap-to-select.
- **Depends**: Phase 1
- **Blocks**: Phase 6
- **Tasks**: 6

### Phase 6: Polish
- **Type**: epic
- **Priority**: 5
- **Description**: Edge cases, empty states, circular dependency detection, orphan bead grouping, animated transitions, and performance optimization.
- **Depends**: Phase 3, Phase 4, Phase 5
- **Tasks**: 5

## Tasks

### Phase 1: Backend Graph API

| Title | Path |
|-------|------|
| Write unit tests for getBeadsGraph service function | backend/tests/unit/beads-graph.test.ts |
| Add BeadsGraphResponse and GraphDependency Zod schemas | backend/src/types/beads.ts |
| Implement getBeadsGraph() that extracts dependencies from bd list output | backend/src/services/beads-service.ts |
| Write unit tests for GET /api/beads/graph route handler | backend/tests/unit/beads-graph-route.test.ts |
| Add GET /api/beads/graph route handler (registered before /:id) | backend/src/routes/beads.ts |

### Phase 2: Web Graph Rendering (US1)

| Title | Path |
|-------|------|
| Install @xyflow/react and @dagrejs/dagre packages | frontend/ |
| Add GraphNode and GraphEdge frontend types | frontend/src/types/beads.ts |
| Add fetchBeadsGraph() API call | frontend/src/services/api.ts |
| Write unit tests for useBeadsGraph hook | frontend/tests/unit/useBeadsGraph.test.ts |
| Implement useBeadsGraph hook with fetch, dagre layout, and transformation | frontend/src/hooks/useBeadsGraph.ts |
| Create BeadGraphNode custom node with Pip-Boy status colors | frontend/src/components/beads/BeadGraphNode.tsx |
| Create DependencyGraphView with React Flow, dagre layout, pan/zoom | frontend/src/components/beads/DependencyGraphView.tsx |
| Add Graph view toggle to Beads tab header | frontend/src/components/beads/BeadsView.tsx |
| Import React Flow CSS and add Pip-Boy theme overrides | frontend/src/styles/ |

### Phase 3: Web Graph Interactions (US2)

| Title | Path |
|-------|------|
| Write unit tests for GraphDetailPanel | frontend/tests/unit/GraphDetailPanel.test.ts |
| Create GraphDetailPanel slide-out with bead info and assign button | frontend/src/components/beads/GraphDetailPanel.tsx |
| Add node selection state and click handler to DependencyGraphView | frontend/src/components/beads/DependencyGraphView.tsx |
| Create BeadGraphEdge custom edge with hover highlight and tooltip | frontend/src/components/beads/BeadGraphEdge.tsx |
| Implement collapse/expand sub-trees with dagre re-layout | frontend/src/hooks/useBeadsGraph.ts |
| Create GraphControls with epic filter dropdown and collapse all button | frontend/src/components/beads/GraphControls.tsx |

### Phase 4: Web Critical Path (US3)

| Title | Path |
|-------|------|
| Write unit tests for critical path algorithm | frontend/tests/unit/criticalPath.test.ts |
| Implement critical path computation (longest chain of non-closed nodes) | frontend/src/hooks/useBeadsGraph.ts |
| Add critical path visual highlighting (thicker edges, pulsing, contrast) | frontend/src/components/beads/DependencyGraphView.tsx |
| Add "Show Critical Path" toggle to GraphControls | frontend/src/components/beads/GraphControls.tsx |

### Phase 5: iOS Graph View (US4)

| Title | Path |
|-------|------|
| Write unit tests for DependencyGraphViewModel layout algorithm | ios/AdjutantTests/ |
| Implement DependencyGraphViewModel with layered layout and critical path | ios/Adjutant/Features/Beads/ViewModels/DependencyGraphViewModel.swift |
| Create DependencyGraphNodeView CRTCard wrapper | ios/Adjutant/Features/Beads/Views/DependencyGraphNodeView.swift |
| Create DependencyGraphEdgeCanvas for drawing edges | ios/Adjutant/Features/Beads/Views/DependencyGraphEdgeCanvas.swift |
| Create DependencyGraphView ZStack container with pan/zoom gestures | ios/Adjutant/Features/Beads/Views/DependencyGraphView.swift |
| Add Graph view toggle to BeadsListView | ios/Adjutant/Features/Beads/BeadsListView.swift |

### Phase 6: Polish

| Title | Path |
|-------|------|
| Create GraphEmptyState for no-deps and no-beads messages | frontend/src/components/beads/GraphEmptyState.tsx |
| Add circular dependency detection and warning indicator | frontend/src/hooks/useBeadsGraph.ts |
| Render orphan beads in "Unlinked" group at graph edge | frontend/src/components/beads/DependencyGraphView.tsx |
| Add animated node state transitions on polling refresh | frontend/src/components/beads/DependencyGraphView.tsx |
| Performance profiling and React.memo optimization for 100+ nodes | frontend/src/components/beads/ |

## Summary

| Phase | Tasks | Priority |
|-------|-------|----------|
| Phase 1: Backend API | 5 | 1 |
| Phase 2: Web Rendering (US1) | 9 | 1 |
| Phase 3: Interactions (US2) | 6 | 2 |
| Phase 4: Critical Path (US3) | 4 | 3 |
| Phase 5: iOS (US4) | 6 | 4 |
| Phase 6: Polish | 5 | 5 |
| **Total** | **35** | |

## MVP Scope

- Phase 1 (Backend API): 5 tasks
- Phase 2 (Web Rendering): 9 tasks
- **Total MVP**: 14 tasks

## Notes

- Constitution requires TDD: test tasks precede implementation tasks in each phase
- Pure UI components (styling only) do not require pre-written tests per constitution II exception
- Each phase is independently testable and deliverable
- Phase 2 and Phase 5 can run in parallel after Phase 1 completes (web and iOS)
- Phase 3 and Phase 4 can run in parallel after Phase 2 completes
- Critical path: Phase 1 → Phase 2 → Phase 3 → Phase 6 (longest chain)
