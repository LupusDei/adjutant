# Quickstart: Bead Dependency Visualization Graph

**Feature**: 018-bead-dep-graph
**Date**: 2026-02-24

## Prerequisites

- Adjutant backend running (`npm run dev` from backend/)
- Adjutant frontend running (`npm run dev` from frontend/)
- At least one project with beads that have wired dependencies (`bd dep add`)
- For iOS: Xcode with the adjutant project open

## 1. Verify Graph API Endpoint

```bash
# Fetch graph data for town beads (default)
curl http://localhost:3001/api/beads/graph | jq '.nodes | length, .edges | length'

# Expected: non-zero node count and edge count
# Example: 42 nodes, 58 edges

# Fetch with status filter
curl "http://localhost:3001/api/beads/graph?status=all" | jq '.edges[:3]'

# Expected: array of {issueId, dependsOnId, type} objects
```

## 2. Test Web Graph View

1. Open the Adjutant dashboard in a browser
2. Navigate to the **Beads** tab
3. Click the **Graph** toggle (alongside Kanban/List)
4. **Verify**: Beads appear as connected nodes in a top-to-bottom hierarchy
5. **Verify**: Nodes are color-coded by status (green=closed, amber=in_progress, red=blocked, gray=open)
6. **Verify**: Epic nodes are visually larger than task nodes

## 3. Test Graph Interactions

1. **Pan**: Click and drag on empty canvas area — graph should move
2. **Zoom**: Scroll wheel — graph should zoom in/out smoothly
3. **Select**: Click a node — detail panel should slide open on the right
4. **Verify detail panel**: Shows bead ID, title, status, priority, assignee, description
5. **Assign**: Click "Assign" in detail panel, select an agent — node should update
6. **Collapse**: Click the collapse button on an epic node — children should hide, count badge appears
7. **Expand**: Click the expand button — children reappear

## 4. Test Critical Path

1. Ensure there is an epic with multiple chains of open dependencies
2. Toggle **"Show Critical Path"** button
3. **Verify**: The longest chain of open/in_progress beads highlights with distinct edge styling
4. Close one bead on the critical path
5. **Verify**: Critical path recalculates to the new longest open chain

## 5. Test Edge Cases

1. **Orphan beads**: Create a bead with no dependencies — should appear in "Unlinked" group
2. **Empty state**: Filter to a status with no beads — should show "No dependency relationships found"
3. **Large graph**: Load a project with 50+ beads — should render without overlap, pannable and zoomable

## 6. Test iOS Graph View

1. Open the Adjutant iOS app
2. Navigate to the **Beads** tab
3. Select the **Graph** view
4. **Verify**: Dependency graph renders with CRT/Pip-Boy styling
5. **Tap** a node — detail sheet should present
6. **Pinch to zoom** and **drag to pan** — should respond at 60fps
