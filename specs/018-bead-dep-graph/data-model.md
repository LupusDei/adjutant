# Data Model: Bead Dependency Visualization Graph

**Feature**: 018-bead-dep-graph
**Date**: 2026-02-24

## Entities

### GraphNode

Represents a bead rendered as a node in the dependency graph.

| Field | Type | Description |
|-------|------|-------------|
| id | string | Bead ID (e.g., "hq-vts8", "adj-021.1.3") |
| title | string | Bead title |
| status | BeadStatus | "open" \| "hooked" \| "in_progress" \| "blocked" \| "closed" |
| type | string | "epic" \| "task" \| "bug" \| "feature" |
| priority | number | 0-4 (lower = higher priority) |
| assignee | string \| null | Assigned agent name |
| source | string | "town" or rig name |
| position | { x: number, y: number } | Computed by layout algorithm (not from API) |
| measured | { width: number, height: number } | Measured after render (web only) |
| isCollapsed | boolean | Whether this node's children are hidden |
| isCriticalPath | boolean | Whether this node is on the critical path |
| isOrphan | boolean | Whether this node has no dependencies |

### GraphEdge

Represents a dependency relationship between two beads.

| Field | Type | Description |
|-------|------|-------------|
| id | string | Derived: `${issueId}-${dependsOnId}` |
| issueId | string | The bead that has this dependency (parent) |
| dependsOnId | string | The bead it depends on (child) |
| type | string | Relationship type from bd CLI |
| isCriticalPath | boolean | Whether this edge is on the critical path |

### BeadsGraphResponse (API)

Response shape from `GET /api/beads/graph`.

| Field | Type | Description |
|-------|------|-------------|
| nodes | BeadInfo[] | All beads matching filter criteria |
| edges | GraphDependency[] | All dependency relationships between returned beads |

### GraphDependency (API)

Individual dependency edge from API.

| Field | Type | Description |
|-------|------|-------------|
| issueId | string | Bead that declared the dependency |
| dependsOnId | string | Bead that is depended on |
| type | string | Relationship type |

## State Transitions

### Node Visual States

```
open (dim gray) → in_progress (amber) → closed (green)
                → blocked (red)
                → hooked (amber)
```

### Collapse States

```
expanded (show all children) ↔ collapsed (hide children, show count badge)
```

### Selection States

```
unselected (normal) → selected (glow, detail panel open)
                    → hovered (slight highlight, edge tooltip)
```

## Relationships

- **Epic → Sub-Epic**: Parent node depends on child (issueId = parent, dependsOnId = child)
- **Sub-Epic → Task**: Same pattern, one level deeper
- **Task → Task**: Blocking relationship (task A blocks task B)
- **Orphan**: Node with no edges in either direction — rendered in separate "Unlinked" group

## Critical Path Computation

The critical path is the longest chain of non-closed nodes from a root node to a leaf node.

**Algorithm**:
1. Filter to non-closed nodes only
2. Build adjacency list from edges
3. For each root node (no incoming edges): run DFS tracking chain length
4. The chain with maximum length is the critical path
5. Mark all nodes and edges on this chain as `isCriticalPath = true`

## iOS Data Model

Uses existing `BeadInfo` and `BeadDetail` from AdjutantKit. New types:

### BeadGraphNode (iOS)

| Field | Type | Description |
|-------|------|-------------|
| bead | BeadInfo | The underlying bead data |
| position | CGPoint | Computed position from layout |
| layer | Int | Depth in hierarchy (0 = root) |
| isCollapsed | Bool | Children hidden |
| isCriticalPath | Bool | On critical path |

### BeadGraphEdge (iOS)

| Field | Type | Description |
|-------|------|-------------|
| fromId | String | Source bead ID |
| toId | String | Target bead ID |
| type | String | Relationship type |
| isCriticalPath | Bool | On critical path |
