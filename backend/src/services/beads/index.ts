/**
 * Barrel index for the beads service module.
 *
 * Re-exports everything from the sub-modules so consumers can import
 * from "services/beads/index.js" as a drop-in replacement for the
 * original monolithic "services/beads-service.js".
 *
 * Sub-modules:
 *   - types.ts            — shared type definitions + constants
 *   - beads-repository.ts — CLI access, CRUD, prefix map, all I/O functions
 *   - beads-filter.ts     — pure filter functions
 *   - beads-sorter.ts     — pure sort functions
 *   - beads-dependency.ts — pure graph/epic logic
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
  UpdateBeadOptions,
  EpicWithChildren,
  EpicProgress,
  ProjectBeadsOverview,
  BeadSource,
  BeadsGraphOptions,
  FetchResult,
} from "./types.js";

export { DEFAULT_STATUSES, ALL_STATUSES } from "./types.js";

// ============================================================================
// Repository (I/O functions — CLI access, CRUD, prefix map)
// ============================================================================

export {
  refreshPrefixMap,
  startPrefixMapRefreshScheduler,
  stopPrefixMapRefreshScheduler,
  listBeadSources,
  getBead,
  isBeadEpic,
  autoCompleteEpics,
  updateBead,
  updateBeadStatus,
  listBeads,
  listAllBeads,
  getEpicChildren,
  listEpicsWithProgress,
  listRecentlyClosed,
  getProjectOverview,
  computeEpicProgress,
  getRecentlyCompletedEpics,
  getBeadsGraph,
  // Test-only exports
  _extractRig,
  _prefixToSource,
  _parseStatusFilter,
  _resetPrefixMap,
} from "./beads-repository.js";

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
