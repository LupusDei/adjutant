# Implementation Plan: Bead Dependency Visualization Graph

**Branch**: `018-bead-dep-graph` | **Date**: 2026-02-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/018-bead-dep-graph/spec.md`

## Summary

Add an interactive dependency graph view to the Beads tab (web and iOS) that visualizes bead hierarchies as a directed acyclic graph. Uses React Flow v12 with dagre layout on web, custom ZStack hybrid with topological-sort layout on iOS, and a new `GET /api/beads/graph` endpoint that extracts dependency data already present in `bd list` output.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) + Swift 5.9+
**Primary Dependencies**: React 18+, @xyflow/react v12, @dagrejs/dagre, Express, SwiftUI
**Storage**: N/A (reads from existing beads databases via bd CLI)
**Testing**: Vitest (backend + frontend), XCTest (iOS)
**Target Platform**: Web (Chrome/Safari/Firefox) + iOS 17+
**Project Type**: Web + Mobile
**Performance Goals**: 60fps pan/zoom, layout computation <2s for 100 nodes, interaction response <200ms
**Constraints**: Graph must work with existing 30s polling interval, no new persistent storage
**Scale/Scope**: Up to ~500 beads per project, typically 20-100 visible in filtered view

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type Safety First | PASS | All new types defined with Zod validation at API boundary. Graph response validated. |
| II. Test-First Development | PASS | TDD for graph API endpoint, layout algorithm, React hook, iOS ViewModel. |
| III. UI Performance | PASS | React Flow viewport culling + React.memo for nodes. iOS Canvas for edges, .drawingGroup() escape hatch. 60fps target. |
| IV. Documentation | PASS | JSDoc on public graph components and service functions. |
| V. Simplicity | PASS | React Flow is a single library (not building from scratch). dagre handles layout. iOS uses zero third-party deps. No over-engineering. |

**Quality Gates**:
- TypeScript compiles with zero errors
- All unit tests pass
- Linting passes with zero warnings
- No `any` types except with explicit justification
- New components include basic unit tests for stateful logic

## Project Structure

### Documentation (this feature)

```text
specs/018-bead-dep-graph/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0 research output
├── data-model.md        # Phase 1 data model
├── quickstart.md        # Phase 1 testing guide
├── contracts/
│   └── api.yaml         # Phase 1 OpenAPI contract
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
backend/src/
├── routes/
│   └── beads.ts                    # Add GET /api/beads/graph route
├── services/
│   └── beads-service.ts            # Add getBeadsGraph() function
└── types/
    └── beads.ts                    # Add BeadsGraphResponse, GraphDependency types

frontend/src/
├── components/beads/
│   ├── DependencyGraphView.tsx     # Main graph container (React Flow)
│   ├── BeadGraphNode.tsx           # Custom node component (Pip-Boy styled)
│   ├── BeadGraphEdge.tsx           # Custom edge component (animated)
│   ├── GraphDetailPanel.tsx        # Slide-out detail panel on node click
│   ├── GraphControls.tsx           # Critical path toggle, epic filter, collapse all
│   └── GraphEmptyState.tsx         # Empty/no-deps message
├── hooks/
│   └── useBeadsGraph.ts            # Fetch graph data, layout computation, critical path
├── services/
│   └── api.ts                      # Add fetchBeadsGraph() API call
└── types/
    └── beads.ts                    # Add GraphNode, GraphEdge frontend types

ios/Adjutant/Features/Beads/
├── Views/
│   ├── DependencyGraphView.swift           # ZStack hybrid: Canvas edges + SwiftUI nodes
│   ├── DependencyGraphNodeView.swift       # CRTCard wrapper for graph node
│   └── DependencyGraphEdgeCanvas.swift     # Canvas subview drawing all edges
└── ViewModels/
    └── DependencyGraphViewModel.swift      # Layout algorithm, selection, critical path
```

**Structure Decision**: Web application (backend + frontend) with iOS mobile companion. New files added to existing `components/beads/` and `Features/Beads/` directories following established patterns.

## Implementation Phases

### Phase 1: Backend Graph API (no dependencies)

Add `GET /api/beads/graph` endpoint that returns `{ nodes, edges }` by extracting dependency data from `bd list --json` output (already present but currently discarded).

**Deliverables**:
- Zod schema for `BeadsGraphResponse`
- `getBeadsGraph()` service function in beads-service.ts
- Route handler in beads.ts (registered before `/:id`)
- Unit tests for service and route

**Blocks**: Phase 2, Phase 3, Phase 4

### Phase 2: Web Graph Rendering (depends on Phase 1)

Install `@xyflow/react` and `@dagrejs/dagre`. Create `DependencyGraphView` with custom `BeadGraphNode` component, dagre layout, pan/zoom, and view toggle in Beads tab.

**Deliverables**:
- npm packages installed
- `DependencyGraphView.tsx` with React Flow integration
- `BeadGraphNode.tsx` custom node with Pip-Boy theming
- `useBeadsGraph.ts` hook for data fetching and layout
- View toggle button in Beads tab header
- Unit tests for hook and layout logic

**Blocks**: Phase 3

### Phase 3: Web Graph Interactions (depends on Phase 2)

Add click-to-detail panel, node selection state, edge hover tooltips, collapse/expand sub-trees, epic filter dropdown, and agent assignment from detail panel.

**Deliverables**:
- `GraphDetailPanel.tsx` slide-out with bead info and assign button
- `GraphControls.tsx` with epic filter and collapse all
- Collapse/expand with dagre re-layout on toggle
- `BeadGraphEdge.tsx` custom edge with hover highlight
- Unit tests for interaction logic

**Blocks**: Phase 5

### Phase 4: Web Critical Path (depends on Phase 2)

Implement critical path computation (longest chain of non-closed nodes) and highlight rendering.

**Deliverables**:
- Critical path algorithm in `useBeadsGraph.ts`
- Visual highlighting: thicker edges, pulsing animation, contrasting color
- Toggle button in `GraphControls.tsx`
- Unit tests for critical path algorithm

### Phase 5: iOS Graph View (depends on Phase 1)

Implement the iOS dependency graph using ZStack hybrid approach: Canvas for edges, SwiftUI CRTCard views for nodes, MagnifyGesture + DragGesture for pan/zoom.

**Deliverables**:
- `DependencyGraphViewModel.swift` with layered layout algorithm
- `DependencyGraphView.swift` ZStack container with gestures
- `DependencyGraphNodeView.swift` CRTCard node
- `DependencyGraphEdgeCanvas.swift` Canvas edge renderer
- View toggle in BeadsListView
- Unit tests for ViewModel layout and critical path

### Phase 6: Polish (depends on Phases 3, 4, 5)

Edge cases, performance optimization, empty states, circular dependency detection, orphan bead grouping, animation polish.

**Deliverables**:
- Empty state component for no-deps and no-beads
- Circular dependency detection and warning indicator
- Orphan bead "Unlinked" group rendering
- Performance profiling and React.memo optimization
- Polling refresh with animated state transitions

## Complexity Tracking

No constitution violations. No complexity justifications needed.
