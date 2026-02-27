/**
 * Shared type definitions for the beads service module.
 *
 * Extracted from beads-service.ts to support the modular decomposition
 * of the beads service into repository, index, and graph sub-modules.
 */

// Re-export types from bd-client that sub-modules need
export type { BeadsIssue } from "../bd-client.js";

// Re-export graph types from types/beads
export type { BeadsGraphResponse, GraphDependency, GraphNode } from "../../types/beads.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Bead display info for the UI.
 */
export interface BeadInfo {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  type: string;
  assignee: string | null;
  /** Rig name extracted from assignee (e.g., "gastown_boy") or null for town-level */
  rig: string | null;
  /** Source database: "town" for hq-*, or rig name for rig-specific beads */
  source: string;
  labels: string[];
  createdAt: string;
  updatedAt: string | null;
}

/**
 * Detailed bead info for the detail view.
 * Includes description and relationship info.
 */
export interface BeadDetail extends BeadInfo {
  description: string;
  closedAt: string | null;
  /** Agent state if assigned (working, idle, stuck, stale) */
  agentState: string | null;
  /** Dependencies this bead has */
  dependencies: Array<{
    issueId: string;
    dependsOnId: string;
    type: string;
  }>;
  /** Whether this is a wisp (transient work unit) */
  isWisp: boolean;
  /** Whether this is pinned */
  isPinned: boolean;
}

/**
 * Recently closed bead info for the widget/activity feed.
 */
export interface RecentlyClosedBead {
  id: string;
  title: string;
  assignee: string | null;
  closedAt: string;
  type: string;
  priority: number;
  rig: string | null;
  source: string;
}

/**
 * Valid sort fields accepted by `bd list --sort`.
 */
export const VALID_SORT_FIELDS = [
  "priority", "created", "updated", "closed", "status", "id", "title", "type", "assignee",
] as const;
export type BeadSortField = typeof VALID_SORT_FIELDS[number];

export interface ListBeadsOptions {
  rig?: string;
  /** Path to rig's directory containing .beads/ - if provided, queries that rig's beads database */
  rigPath?: string;
  status?: string;
  type?: string;
  limit?: number;
  /** Filter beads by assignee (exact match on assignee field) */
  assignee?: string;
  /** Prefixes to exclude (e.g., ["hq-"] to hide town-level system beads) */
  excludePrefixes?: string[];
  /** Sort field passed to `bd list --sort` */
  sort?: BeadSortField;
  /** Sort order: "asc" (default) or "desc" (adds --reverse to bd args) */
  order?: "asc" | "desc";
}

export interface BeadsServiceResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Valid bead status values for Kanban workflow.
 * Workflow: open -> hooked/in_progress/blocked -> closed
 *
 * NOTE: Epics cannot be closed directly. They auto-complete when all
 * sub-beads are closed (via `bd epic close-eligible`).
 */
export type BeadStatus =
  | "open"         // Ready to be picked up
  | "hooked"       // Agent has task on hook
  | "in_progress"  // Actively being worked
  | "blocked"      // Blocked on something
  | "closed";      // Totally done

/**
 * Options for updating a bead. At least one field must be provided.
 */
export interface UpdateBeadOptions {
  status?: BeadStatus;
  assignee?: string;
}

/**
 * Epic with progress info computed server-side using dependency graph.
 */
export interface EpicWithChildren {
  epic: BeadInfo;
  children: BeadInfo[];
  totalCount: number;
  closedCount: number;
  progress: number;
}

/**
 * Epic progress info for the project overview.
 */
export interface EpicProgress {
  id: string;
  title: string;
  status: string;
  totalChildren: number;
  closedChildren: number;
  completionPercent: number;
  assignee: string | null;
  closedAt?: string | null;
}

/**
 * Project overview data aggregated from beads.
 */
export interface ProjectBeadsOverview {
  open: BeadInfo[];
  inProgress: BeadInfo[];
  recentlyClosed: BeadInfo[];
}

// ============================================================================
// Bead Sources
// ============================================================================

/**
 * A bead source represents a project/rig directory that contains beads.
 */
export interface BeadSource {
  /** Display name (rig name or "project") */
  name: string;
  /** Absolute path to the working directory */
  path: string;
  /** Whether this directory has beads */
  hasBeads: boolean;
}

// ============================================================================
// Beads Dependency Graph
// ============================================================================

/**
 * Options for querying the beads dependency graph.
 * Mirrors the query params from GET /api/beads/graph.
 */
export interface BeadsGraphOptions {
  /** Which database(s) to query: "town" (default), "all", or a specific rig name */
  rig?: string | undefined;
  /** Status filter: "default", "all", or specific status(es) */
  status?: string | undefined;
  /** Filter by bead type (e.g., "epic", "task", "bug") */
  type?: string | undefined;
  /** Filter to a specific epic's sub-tree (client-side hint) */
  epicId?: string | undefined;
  /** Exclude hq-* town beads when rig=all */
  excludeTown?: boolean | undefined;
}

// ============================================================================
// Internal shared types
// ============================================================================

/** Result from fetching beads from a single database. */
export interface FetchResult {
  beads: BeadInfo[];
  /** Non-null if the fetch failed. Callers can decide whether to treat as fatal. */
  error?: { code: string; message: string };
}

// ============================================================================
// Status constants
// ============================================================================

/**
 * Default status preset: shows active work (not closed).
 */
export const DEFAULT_STATUSES: BeadStatus[] = [
  "open", "hooked", "in_progress", "blocked"
];

/**
 * All valid statuses for filtering.
 */
export const ALL_STATUSES: BeadStatus[] = [
  "open", "hooked", "in_progress", "blocked", "closed"
];
