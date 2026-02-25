# Feature Specification: Bead Dependency Visualization Graph

**Feature Branch**: `018-bead-dep-graph`
**Created**: 2026-02-24
**Status**: Draft
**Input**: User description: "Add an interactive dependency graph view to the Beads tab that visualizes epic-to-task hierarchies as a directed acyclic graph (DAG), with status color coding, critical path highlighting, and click-to-detail interaction."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Dependency Graph (Priority: P1)

As the Mayor, I want to see all beads in my current project rendered as an interactive directed graph so I can understand the full dependency tree at a glance — which epics contain which tasks, what blocks what, and where bottlenecks exist.

Today, the Beads tab shows a flat Kanban board grouped by status columns. I can see individual bead cards, but I cannot see how they relate to each other. I have to click into each bead detail individually to discover its dependencies. For a 24-task epic with sub-epics, this is unworkable. I need a single view that shows the entire hierarchy as a connected graph.

**Why this priority**: This is the core value proposition. Without the graph rendering, nothing else matters. A static graph with no interactivity still delivers 80% of the insight.

**Independent Test**: Can be fully tested by loading a project with known bead dependencies and verifying the graph renders nodes and edges that match the dependency data. Delivers immediate visual understanding of project structure.

**Acceptance Scenarios**:

1. **Given** a project with at least one epic containing sub-epics and tasks with wired dependencies, **When** the user switches to the Graph view in the Beads tab, **Then** all beads are rendered as nodes in a directed graph with edges showing dependency relationships (parent depends-on children flow top-to-bottom or left-to-right).
2. **Given** beads with different statuses (open, in_progress, blocked, closed), **When** the graph renders, **Then** each node is color-coded by status: green for closed, amber for in_progress, red for blocked, dim for open.
3. **Given** beads with different types (epic, task, bug), **When** the graph renders, **Then** epic nodes are visually distinct from task nodes (larger size, different border style, or type badge).
4. **Given** a graph with more than 30 nodes, **When** the user views it, **Then** the layout algorithm positions nodes without overlapping text or edges, and the graph is pannable and zoomable.
5. **Given** beads with no dependencies (orphan beads), **When** the graph renders, **Then** orphan beads appear as disconnected nodes grouped separately so they do not clutter the main dependency tree.

---

### User Story 2 - Interact with Graph Nodes (Priority: P2)

As the Mayor, I want to click on any node in the dependency graph to see its details and take action (assign, update status) without leaving the graph view, so I can manage work directly from the visualization.

**Why this priority**: Static visualization delivers insight but not action. Click-to-detail transforms the graph from a read-only diagram into an operational tool. This is the difference between "nice to see" and "I work from this view."

**Independent Test**: Can be tested by clicking nodes in the graph and verifying the detail panel opens with correct bead information and action buttons work.

**Acceptance Scenarios**:

1. **Given** a rendered dependency graph, **When** the user clicks on a node, **Then** a detail panel slides open showing the bead's full information (ID, title, status, priority, assignee, description, dependencies).
2. **Given** an open detail panel, **When** the user clicks "Assign" and selects an agent, **Then** the bead's assignee updates and the node's visual state reflects the change (e.g., shows assignee initials or avatar).
3. **Given** a graph with a selected node, **When** the user clicks a different node, **Then** the detail panel updates to show the newly selected node's information.
4. **Given** a rendered graph, **When** the user hovers over an edge, **Then** the edge highlights and a tooltip shows the relationship type (e.g., "blocks" or "blocked by").

---

### User Story 3 - Critical Path Highlighting (Priority: P3)

As the Mayor, I want the graph to highlight the critical path — the longest chain of unfinished dependencies blocking epic completion — so I can focus attention on the work that actually gates shipping.

**Why this priority**: Critical path analysis is the highest-value insight from a dependency graph for project management. However, the graph itself (US1) and interactivity (US2) must exist first. This is a layer on top.

**Independent Test**: Can be tested by creating a known dependency chain where one path is longer than others and verifying the system highlights the correct chain.

**Acceptance Scenarios**:

1. **Given** an epic with multiple dependency chains of different lengths, **When** the user toggles "Show Critical Path," **Then** the longest chain of open/in-progress beads is highlighted with distinct edge styling (thicker lines, pulsing animation, or contrasting color).
2. **Given** a critical path where one bead is closed, **When** the graph recalculates, **Then** the critical path updates to reflect the new longest open chain.
3. **Given** all beads on the critical path are closed, **When** the user views the graph, **Then** no critical path is highlighted and a "No open critical path" indicator is shown.

---

### User Story 4 - iOS Dependency Graph (Priority: P4)

As a mobile user, I want to view the bead dependency graph on the iOS app with the same visual hierarchy and status color coding, adapted for touch interaction (pinch to zoom, tap to select).

**Why this priority**: Mobile parity is important but secondary to the web experience where most project management happens. The iOS version can ship as a follow-on after web is stable.

**Independent Test**: Can be tested on iOS by loading the same project and verifying the graph renders with correct nodes, edges, and tap-to-detail interaction.

**Acceptance Scenarios**:

1. **Given** the iOS Beads tab, **When** the user selects the Graph view, **Then** beads render as a dependency graph matching the web layout with Pip-Boy styling (green phosphor on dark background).
2. **Given** the iOS graph view, **When** the user taps a node, **Then** a detail sheet presents with the bead's full information.
3. **Given** a large graph on iOS, **When** the user pinch-zooms or pans, **Then** the graph responds fluidly at 60fps.

---

### Edge Cases

- What happens when a project has zero beads with dependencies? The graph view shows an empty state message: "No dependency relationships found. Use `bd dep add` to wire bead hierarchies."
- What happens when circular dependencies exist in the data? The system detects cycles during graph construction and renders them with a warning indicator (e.g., red circular arrow icon) rather than crashing or looping infinitely.
- What happens when a bead referenced in a dependency no longer exists (orphan reference)? The edge renders with a dashed line to a "missing" placeholder node, and a warning badge appears.
- How does the graph handle very large projects (100+ beads)? The layout algorithm groups by epic, supports collapse/expand of sub-trees, and defaults to showing only the selected epic's tree rather than all beads at once.
- What happens when beads are updated while viewing the graph? The graph refreshes on the existing polling interval (30 seconds) and animates node transitions rather than re-rendering from scratch.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a "Graph" view toggle in the Beads tab alongside the existing Kanban view, allowing users to switch between views without losing filter state.
- **FR-002**: System MUST render beads as nodes in a directed acyclic graph where edges represent dependency relationships (parent-to-child, blocks/blocked-by).
- **FR-003**: System MUST color-code nodes by status: green (closed), amber (in_progress/hooked), red (blocked), dim gray (open).
- **FR-004**: System MUST visually distinguish bead types: epics displayed larger with a distinct border, tasks at standard size, bugs with a bug indicator.
- **FR-005**: System MUST layout nodes using an automatic hierarchical algorithm that positions parent nodes above children, avoids edge crossings where possible, and prevents node overlap.
- **FR-006**: System MUST support pan and zoom interactions (mouse drag + scroll wheel on web, pinch + drag on iOS).
- **FR-007**: System MUST display a detail panel when a node is clicked/tapped, showing bead ID, title, status, priority, assignee, description, and dependency list.
- **FR-008**: System MUST allow assigning an agent to a bead directly from the graph detail panel.
- **FR-009**: System MUST provide a "Critical Path" toggle that highlights the longest chain of open dependencies from root epic to leaf tasks.
- **FR-010**: System MUST handle orphan beads (no dependencies) by rendering them in a separate "Unlinked" group at the edge of the graph.
- **FR-011**: System MUST detect circular dependencies and render them with a warning indicator rather than failing.
- **FR-012**: System MUST support collapsing/expanding epic sub-trees so users can focus on specific branches.
- **FR-013**: System MUST provide an epic filter so users can view the dependency tree for a single epic rather than all beads.
- **FR-014**: System MUST refresh graph data on the standard polling interval and animate node state transitions (status changes, new nodes) smoothly.
- **FR-015**: iOS app MUST provide the same graph visualization adapted for touch interaction with CRT/Pip-Boy theming.

### Key Entities

- **Graph Node**: Represents a single bead. Attributes: bead ID, title, status, type, priority, assignee, position (computed by layout algorithm).
- **Graph Edge**: Represents a dependency relationship between two beads. Attributes: source node ID, target node ID, relationship type (blocks/blocked_by), visual state (normal, critical path, warning).
- **Critical Path**: The longest chain of non-closed nodes from a root epic to a leaf task. Computed dynamically from current bead statuses.
- **Sub-tree**: A collapsible group of nodes rooted at an epic or sub-epic, allowing users to show/hide branches.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can identify which beads block epic completion within 5 seconds of viewing the graph, compared to the current workflow of clicking into 5+ individual bead detail views.
- **SC-002**: The graph renders up to 100 nodes with layout computation completing in under 2 seconds on a standard device.
- **SC-003**: 90% of graph interactions (click, pan, zoom, collapse) respond in under 200 milliseconds, maintaining a smooth 60fps experience.
- **SC-004**: Users can complete a bead assignment directly from the graph view without navigating away, reducing the steps-to-assign from 3 (navigate to bead > open detail > assign) to 1 (click node > assign).
- **SC-005**: Critical path highlighting correctly identifies the longest open dependency chain in 100% of test cases with known dependency structures.
- **SC-006**: The graph view is available on both web and iOS platforms with feature parity for core visualization (nodes, edges, status colors, pan/zoom).

## Assumptions

- The existing `GET /api/beads/:id` endpoint returns dependency data, but a batch endpoint returning all beads with dependencies may be needed for efficient graph rendering. This is a backend consideration for the planning phase.
- The standard 30-second polling interval is sufficient for graph refresh; real-time WebSocket updates for the graph are not required for MVP.
- The graph layout should default to top-down (root at top, leaves at bottom) which aligns with how hierarchies are typically visualized.
- Epic filter defaults to showing one epic at a time rather than all beads, to keep the graph readable for large projects.
- The iOS implementation may lag behind web by one release cycle, as the web graph must stabilize first.
