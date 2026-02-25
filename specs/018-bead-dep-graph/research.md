# Research: Bead Dependency Visualization Graph

**Feature**: 018-bead-dep-graph
**Date**: 2026-02-24

## Decision 1: Web Graph Visualization Library

**Decision**: Use `@xyflow/react` (React Flow v12) with `@dagrejs/dagre` for layout.

**Rationale**:
- Nodes are native React components — enables full Pip-Boy theming with Tailwind, CRT effects, and existing component patterns
- Total bundle: ~93 KB gzip (82 KB React Flow + 11 KB dagre) — smaller than Cytoscape alone (132 KB)
- Built-in pan/zoom, edge customization, viewport culling for performance
- Official expand/collapse example with dagre re-layout matches our sub-tree collapse requirement
- Actively maintained (v12.10.1 released 2026-02-19)
- Read-only mode: disable `nodesDraggable`, `nodesConnectable`, `elementsSelectable`

**Alternatives considered**:
- **Cytoscape.js**: Powerful but React wrapper stale (2022), custom React component nodes require painful workarounds with canvas overlay sync. Cytoscape's own style DSL conflicts with Tailwind.
- **vis-network**: Canvas-only rendering, no React component nodes. Stale React wrappers.
- **dagre + custom SVG**: Layout-only, requires building all rendering, pan/zoom, hit testing from scratch. Over-engineering for a read-mostly view.
- **elkjs**: Best layout quality but 463 KB gzip (10x dagre). For 100-node DAGs, dagre output is indistinguishable.

## Decision 2: iOS Graph Rendering Approach

**Decision**: Custom layered layout algorithm + ZStack hybrid (Canvas for edges, SwiftUI views for nodes).

**Rationale**:
- Zero third-party dependencies
- Reuses existing CRT component library (CRTCard, CRTText, BadgeView, PhosphorGlow)
- Canvas underneath draws edges as Path bezier curves — no hit testing needed on edges
- SwiftUI CRTCard views on top with standard `.onTapGesture` — full interactivity preserved
- MagnifyGesture + DragGesture on container for pan/zoom (iOS 17+)
- Simple topological-sort layer assignment runs in ViewModel — sub-millisecond for 200 nodes

**Alternatives considered**:
- **SwiftUI Canvas (pure)**: Eliminated — Canvas has no per-element hit testing. Tap-to-select requires manual point-in-polygon math. React component nodes (CRTCard) lose interactivity when resolved into Canvas.
- **Core Animation**: Eliminated — abandons SwiftUI entirely, cannot use CRT component library.
- **Grape (SwiftGraphs)**: Force-directed layout only (no hierarchical), limited node styling, cannot pass CRTCard as node view.

## Decision 3: Backend API for Graph Data

**Decision**: New `GET /api/beads/graph` endpoint returning `{ nodes: BeadInfo[], edges: Dependency[] }`.

**Rationale**:
- `bd list --json --all` already returns dependency data on each bead — the `dependencies` array is present but currently discarded by `transformBead()` in beads-service.ts
- Single CLI call per database (same cost as existing `GET /api/beads`)
- Graph-optimized response shape maps directly to React Flow / iOS graph rendering
- Frontend can filter to epic sub-trees client-side from the full response
- Reuses all existing infrastructure: BdSemaphore, listAllBeadsDirs, resolveBeadsDir, transformBead

**Alternatives considered**:
- **`?include=dependencies` on existing endpoint**: Confusing API design — the data is free to include, toggling it with a param adds unnecessary branching.
- **`/api/beads/graph/:epicId`**: Forces frontend to know which epic before rendering. The full-graph call costs the same (bd list fetches everything). Sub-tree filtering is trivial client-side.
- **N+1 frontend calls**: 555 beads × individual `bd show` calls through BdSemaphore = ~27 seconds serialized. Unacceptable.

## Key Technical Notes

- React Flow v12 uses `node.measured.width/height` (breaking change from v11) — dagre layout must wait for initial render to get measured sizes
- dagre layout helper pattern: `new Dagre.graphlib.Graph().setGraph({ rankdir: 'TB', ranksep: 60, nodesep: 40 })`
- iOS layout: simple layer assignment via topological sort, x-position via barycentric heuristic (median neighbor position)
- Edge styling: Pip-Boy green (#00aa00) at 60% opacity for regular edges, bright green (#00ff00) for critical path
- The existing `BeadsIssue.dependencies` field in `bd-client.ts` (line 68) already declares the correct shape
