/**
 * Barrel index for the beads service module.
 *
 * Re-exports everything from the sub-modules so consumers can import
 * from "services/beads/index.js" as a drop-in replacement.
 *
 * Sub-modules:
 *   - types.ts              — shared type definitions + constants
 *   - beads-prefix-map.ts   — prefix map state, lifecycle, helpers
 *   - beads-transform.ts    — extractRig, transformBead
 *   - beads-database.ts     — database resolution, fetching, sources
 *   - beads-epics.ts        — epic type check, children, progress listing
 *   - beads-mutations.ts    — autoCompleteEpics, updateBead, updateBeadStatus
 *   - beads-queries.ts      — getBead, listBeads, listAllBeads, listRecentlyClosed, getBeadsGraph
 *   - beads-project.ts      — getProjectOverview, computeEpicProgress, getRecentlyCompletedEpics
 *   - beads-filter.ts       — pure filter functions
 *   - beads-sorter.ts       — pure sort functions
 *   - beads-dependency.ts   — pure graph/epic logic
 */

// ============================================================================
// Types + Constants
// ============================================================================

export type {
  BeadsIssue,
  BeadsGraphResponse,
  GraphDependency,
  GraphNode,
  BeadInfo,
  BeadDetail,
  RecentlyClosedBead,
  ListBeadsOptions,
  BeadsServiceResult,
  BeadStatus,
  BeadSortField,
  UpdateBeadOptions,
  EpicWithChildren,
  EpicProgress,
  ProjectBeadsOverview,
  BeadSource,
  BeadsGraphOptions,
  FetchResult,
} from "./types.js";

export { DEFAULT_STATUSES, ALL_STATUSES, VALID_SORT_FIELDS } from "./types.js";

// ============================================================================
// Prefix Map
// ============================================================================

export {
  refreshPrefixMap,
  startPrefixMapRefreshScheduler,
  stopPrefixMapRefreshScheduler,
  prefixToSource,
  // Test-only exports
  _prefixToSource,
  _resetPrefixMap,
} from "./beads-prefix-map.js";

// ============================================================================
// Transform
// ============================================================================

export {
  extractRig,
  transformBead,
  _extractRig,
} from "./beads-transform.js";

// ============================================================================
// Database
// ============================================================================

export {
  resolveBeadDatabase,
  buildDatabaseList,
  fetchBeadsFromDatabase,
  fetchGraphBeadsFromDatabase,
  listBeadSources,
} from "./beads-database.js";

// ============================================================================
// Epics
// ============================================================================

export {
  isBeadEpic,
  getEpicChildren,
  listEpicsWithProgress,
} from "./beads-epics.js";

// ============================================================================
// Mutations
// ============================================================================

export {
  autoCompleteEpics,
  updateBead,
  updateBeadStatus,
} from "./beads-mutations.js";

// ============================================================================
// Queries
// ============================================================================

export {
  getBead,
  listBeads,
  listAllBeads,
  listRecentlyClosed,
  getBeadsGraph,
} from "./beads-queries.js";

// ============================================================================
// Project
// ============================================================================

export {
  getProjectOverview,
  computeEpicProgress,
  getRecentlyCompletedEpics,
} from "./beads-project.js";

// ============================================================================
// Pure Filter Functions
// ============================================================================

export {
  parseStatusFilter,
  excludeWisps,
  deduplicateById,
  filterByAssignee,
  filterByStatuses,
  excludePrefixes,
  filterByRig,
} from "./beads-filter.js";

// ============================================================================
// Pure Sort Functions
// ============================================================================

export {
  sortByPriorityThenDate,
  sortByClosedAtDesc,
  sortByUpdatedAtDesc,
  applyLimit,
} from "./beads-sorter.js";

// ============================================================================
// Pure Dependency/Graph Functions
// ============================================================================

export {
  extractGraphEdges,
  buildGraphNodes,
  processEpicChildren,
  computeEpicProgressFromDeps,
  buildEpicWithChildren,
  transformClosedEpics,
} from "./beads-dependency.js";
