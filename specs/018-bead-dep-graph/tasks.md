# Bead Dependency Visualization Graph - Tasks

**Feature**: 018-bead-dep-graph
**Generated**: 2026-02-24
**Source**: spec.md + plan.md

## Phase 1: Backend Graph API

**Purpose**: Expose dependency graph data via a single efficient endpoint

**Dependencies**: None (first phase)

- [ ] T001 [P] [US1] Write unit tests for getBeadsGraph service function in backend/tests/unit/beads-graph.test.ts
- [ ] T002 [P] [US1] Add BeadsGraphResponse and GraphDependency Zod schemas in backend/src/types/beads.ts
- [ ] T003 [US1] Implement getBeadsGraph() that extracts dependencies from bd list output in backend/src/services/beads-service.ts
- [ ] T004 [US1] Write unit tests for GET /api/beads/graph route handler in backend/tests/unit/beads-graph-route.test.ts
- [ ] T005 [US1] Add GET /api/beads/graph route handler (registered before /:id) in backend/src/routes/beads.ts

**Checkpoint**: Graph API returns `{ nodes, edges }` from a single `bd list` call. Verify with curl.

## Phase 2: Web Graph Rendering (US1 - View Dependency Graph)

**Purpose**: Render beads as a DAG with React Flow, dagre layout, status colors, and pan/zoom

**Dependencies**: Phase 1

- [ ] T006 [P] [US1] Install @xyflow/react and @dagrejs/dagre packages in frontend/
- [ ] T007 [P] [US1] Add GraphNode and GraphEdge frontend types in frontend/src/types/beads.ts
- [ ] T008 [P] [US1] Add fetchBeadsGraph() API call in frontend/src/services/api.ts
- [ ] T009 [US1] Write unit tests for useBeadsGraph hook (data fetching, dagre layout) in frontend/tests/unit/useBeadsGraph.test.ts
- [ ] T010 [US1] Implement useBeadsGraph hook with fetch, dagre layout, and node/edge transformation in frontend/src/hooks/useBeadsGraph.ts
- [ ] T011 [US1] Create BeadGraphNode custom node component with Pip-Boy status colors in frontend/src/components/beads/BeadGraphNode.tsx
- [ ] T012 [US1] Create DependencyGraphView with React Flow, dagre layout, pan/zoom in frontend/src/components/beads/DependencyGraphView.tsx
- [ ] T013 [US1] Add Graph view toggle to Beads tab header alongside existing Kanban/List in frontend/src/components/beads/BeadsView.tsx
- [ ] T014 [US1] Import React Flow CSS and add Pip-Boy theme overrides in frontend/src/styles/

**Checkpoint**: Beads render as a top-to-bottom DAG with status colors. Pan and zoom work. View toggle switches between Kanban and Graph.

## Phase 3: Web Graph Interactions (US2 - Interact with Graph Nodes)

**Purpose**: Add click-to-detail, assignment, collapse/expand, and edge interactions

**Dependencies**: Phase 2

- [ ] T015 [US2] Write unit tests for GraphDetailPanel in frontend/tests/unit/GraphDetailPanel.test.ts
- [ ] T016 [US2] Create GraphDetailPanel slide-out with bead info and assign button in frontend/src/components/beads/GraphDetailPanel.tsx
- [ ] T017 [US2] Add node selection state and click handler to DependencyGraphView in frontend/src/components/beads/DependencyGraphView.tsx
- [ ] T018 [US2] Create BeadGraphEdge custom edge with hover highlight and tooltip in frontend/src/components/beads/BeadGraphEdge.tsx
- [ ] T019 [US2] Implement collapse/expand sub-trees with dagre re-layout in frontend/src/hooks/useBeadsGraph.ts
- [ ] T020 [US2] Create GraphControls with epic filter dropdown and collapse all button in frontend/src/components/beads/GraphControls.tsx

**Checkpoint**: Clicking nodes opens detail panel with assign. Hovering edges shows tooltip. Epic sub-trees collapse/expand.

## Phase 4: Web Critical Path (US3 - Critical Path Highlighting)

**Purpose**: Compute and visually highlight the longest chain of open dependencies

**Dependencies**: Phase 2

- [ ] T021 [P] [US3] Write unit tests for critical path algorithm in frontend/tests/unit/criticalPath.test.ts
- [ ] T022 [US3] Implement critical path computation (longest chain of non-closed nodes) in frontend/src/hooks/useBeadsGraph.ts
- [ ] T023 [US3] Add critical path visual highlighting (thicker edges, pulsing, contrast color) in frontend/src/components/beads/DependencyGraphView.tsx
- [ ] T024 [US3] Add "Show Critical Path" toggle to GraphControls in frontend/src/components/beads/GraphControls.tsx

**Checkpoint**: Critical path toggle highlights the correct longest open chain. Recalculates when beads close.

## Phase 5: iOS Graph View (US4 - iOS Dependency Graph)

**Purpose**: Implement dependency graph on iOS with CRT theming and touch gestures

**Dependencies**: Phase 1

- [ ] T025 [P] [US4] Write unit tests for DependencyGraphViewModel layout algorithm in ios/AdjutantTests/
- [ ] T026 [US4] Implement DependencyGraphViewModel with layered layout and critical path in ios/Adjutant/Features/Beads/ViewModels/DependencyGraphViewModel.swift
- [ ] T027 [US4] Create DependencyGraphNodeView CRTCard wrapper in ios/Adjutant/Features/Beads/Views/DependencyGraphNodeView.swift
- [ ] T028 [US4] Create DependencyGraphEdgeCanvas for drawing edges in ios/Adjutant/Features/Beads/Views/DependencyGraphEdgeCanvas.swift
- [ ] T029 [US4] Create DependencyGraphView ZStack container with pan/zoom gestures in ios/Adjutant/Features/Beads/Views/DependencyGraphView.swift
- [ ] T030 [US4] Add Graph view toggle to BeadsListView in ios/Adjutant/Features/Beads/BeadsListView.swift

**Checkpoint**: iOS graph renders with CRT styling. Pinch-zoom and pan work at 60fps. Tap-to-select opens detail.

## Phase 6: Polish

**Purpose**: Edge cases, empty states, error handling, performance optimization

**Dependencies**: Phases 3, 4, 5

- [ ] T031 [P] Create GraphEmptyState for no-deps and no-beads messages in frontend/src/components/beads/GraphEmptyState.tsx
- [ ] T032 [P] Add circular dependency detection and warning indicator in frontend/src/hooks/useBeadsGraph.ts
- [ ] T033 [P] Render orphan beads in "Unlinked" group at graph edge in frontend/src/components/beads/DependencyGraphView.tsx
- [ ] T034 Add animated node state transitions on polling refresh in frontend/src/components/beads/DependencyGraphView.tsx
- [ ] T035 Performance profiling and React.memo optimization for 100+ node graphs in frontend/src/components/beads/

**Checkpoint**: All edge cases handled. Empty states show helpful messages. Performance verified at 100+ nodes.

## Dependencies

```
Phase 1 (Backend API) ──┬──> Phase 2 (Web Rendering) ──┬──> Phase 3 (Interactions) ──> Phase 6 (Polish)
                        │                               └──> Phase 4 (Critical Path) ──> Phase 6
                        └──> Phase 5 (iOS) ──────────────────────────────────────────> Phase 6
```
