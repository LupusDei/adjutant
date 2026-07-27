/**
 * Types + Zod schemas for the Mission Control portfolio rollup endpoint
 * (`GET /api/overview/projects`, adj-208 US1).
 *
 * One call returns, per project, the active epic + completion, remaining open
 * epics/beads, assigned agents, and a derived status beacon — plus portfolio
 * totals — so the iOS Mission Control map renders in a single request.
 *
 * Each schema is the single source of truth for both runtime validation (the
 * route validates the composed payload before enveloping) and the compile-time
 * type (via `z.infer`), matching the `types/beads.ts` convention.
 *
 * @module types/overview-projects
 */
import { z } from "zod";

// ============================================================================
// Project status beacon
// ============================================================================

/**
 * Per-project status beacon (green/amber/red on the map).
 *
 * Derivation (US1): `blocked` if any bead in the project has status `blocked`;
 * else `needs_input` if the project has any open `agent_question`; else
 * `on_track`.
 */
export const ProjectRollupStatusSchema = z.enum([
  "on_track",
  "needs_input",
  "blocked",
]);
export type ProjectRollupStatus = z.infer<typeof ProjectRollupStatusSchema>;

// ============================================================================
// Active epic
// ============================================================================

/**
 * The epic a project's stream rises toward: the epic currently holding
 * in-progress work (most recent activity). `null` when no epic is active.
 *
 * Field shape mirrors the reused `EpicProgress` domain object so no data is
 * invented at this layer.
 */
export const ActiveEpicSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** 0–100 completion of the epic's children. */
  completionPercent: z.number(),
  closedChildren: z.number(),
  totalChildren: z.number(),
});
export type ActiveEpic = z.infer<typeof ActiveEpicSchema>;

// ============================================================================
// Agent marker
// ============================================================================

/**
 * A single agent assigned to a project, drawn as a marker on the stream.
 * `status` is the raw `CrewMemberStatus` string (e.g. `working`, `idle`).
 */
export const AgentMarkerSchema = z.object({
  id: z.string(),
  status: z.string(),
});
export type AgentMarker = z.infer<typeof AgentMarkerSchema>;

// ============================================================================
// Feature rollup (per in-progress epic within a project stream) — adj-209 US1
// ============================================================================

/**
 * One in-progress epic/feature that a project's stream branches into on the
 * Mission Control map. The map draws each as a distinct node carrying a
 * completion ring, a status beacon, its assigned agents, and — the adj-209
 * addition — a composite `activityLevel` so a busy feature reads visibly
 * "hotter" than a quiet one.
 *
 * The completion fields mirror {@link ActiveEpic} (same `EpicProgress` source,
 * no invented data). `agents` and `activityLevel` are overlaid at response time
 * from live agent status + recent `report_progress` cadence — they are NOT part
 * of the cached bead snapshot, since they change faster than the bead graph.
 */
export const FeatureRollupSchema = z.object({
  /** The epic's bead id. */
  id: z.string(),
  title: z.string(),
  /** 0–100 completion of the epic's children. */
  completionPercent: z.number(),
  closedChildren: z.number(),
  totalChildren: z.number(),
  /** Agents attributed to this feature (assignee of the epic or a child bead). */
  agents: z.array(AgentMarkerSchema).default([]),
  /**
   * Composite agentic intensity in [0,1], monotonic in (engaged agents +
   * in-progress child beads + recent `report_progress` cadence). Normalized with
   * headroom — approaches, but never pins to, 1 — so "busier = hotter" has room
   * to grow. `0` when the feature is idle.
   */
  activityLevel: z.number().default(0),
  /** Raw epic status string (e.g. `in_progress`). */
  status: z.string(),
});
export type FeatureRollup = z.infer<typeof FeatureRollupSchema>;

// ============================================================================
// Per-project stream rollup
// ============================================================================

/**
 * One project's stream on the Mission Control map.
 */
export const ProjectStreamRollupSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  /** The active epic, or `null` when the project has no in-progress epic. */
  activeEpic: ActiveEpicSchema.nullable(),
  /** Count of open, not-started epics (excludes the active epic). */
  epicsRemaining: z.number(),
  /** Count of open, non-epic beads still to do. */
  openBeadsRemaining: z.number(),
  agents: z.array(AgentMarkerSchema),
  status: ProjectRollupStatusSchema,
  /**
   * The project's in-progress epics as branchable feature nodes (adj-209 US1).
   * Empty when the project has no in-progress epic. Default-safe so an older
   * payload (pre-adj-209) still validates.
   */
  features: z.array(FeatureRollupSchema).default([]),
  /**
   * Project-level composite agentic intensity in [0,1] — the same normalized
   * signal as {@link FeatureRollupSchema.activityLevel}, aggregated across ALL
   * the project's agents + in-progress beads + recent progress cadence. Drives
   * the overall stream thickness/brightness/flow-speed. `0` when idle.
   */
  activityLevel: z.number().default(0),
  /**
   * Total agents on the project — UNCAPPED (no 5-dot cap): the map renders the
   * true count. Distinct from the activity signal's "engaged agent" count.
   */
  agentCount: z.number().default(0),
  /**
   * True when this project's live bead data could not be fetched within the
   * per-project timeout (e.g. a cold/slow dolt) and the row is serving stale or
   * empty fallback values. One slow project never blocks the rest of the map.
   */
  degraded: z.boolean().default(false),
});
export type ProjectStreamRollup = z.infer<typeof ProjectStreamRollupSchema>;

// ============================================================================
// Portfolio totals
// ============================================================================

/**
 * Portfolio-wide aggregates rendered in the map header.
 */
export const PortfolioTotalsSchema = z.object({
  /** Number of projects in the rollup. */
  projects: z.number(),
  /** Agents across all projects that are not offline. */
  agentsActive: z.number(),
  /** Sum of `epicsRemaining` across projects. */
  epicsRemaining: z.number(),
  /** Sum of `openBeadsRemaining` across projects. */
  openBeadsRemaining: z.number(),
  /** Number of projects whose status is `blocked`. */
  blocked: z.number(),
  /** Number of projects whose status is `needs_input`. */
  needsInput: z.number(),
  /**
   * Portfolio completion: mean of each active epic's `completionPercent`
   * (projects with no active epic are excluded); 0 when none are active.
   */
  portfolioCompletionPercent: z.number(),
});
export type PortfolioTotals = z.infer<typeof PortfolioTotalsSchema>;

// ============================================================================
// Endpoint response
// ============================================================================

/**
 * The `data` payload of `ApiResponse<T>` for `GET /api/overview/projects`.
 */
export const OverviewProjectsResponseSchema = z.object({
  projects: z.array(ProjectStreamRollupSchema),
  totals: PortfolioTotalsSchema,
});
export type OverviewProjectsResponse = z.infer<
  typeof OverviewProjectsResponseSchema
>;

// ============================================================================
// Request query — optional projectIds filter (adj-209 US1)
// ============================================================================

/**
 * Query params for `GET /api/overview/projects`.
 *
 * `projectIds` is an optional comma-separated allow-list (`?projectIds=a,b,c`):
 * when present, ONLY those projects are rolled up (the fast path — fewer bead
 * fetches, fewer degraded rows). Parsing is default-safe: an absent, empty, or
 * whitespace-only value yields `undefined` (roll up everything), and unknown
 * ids are simply ignored downstream (no error, no existence leak).
 */
export const OverviewProjectsQuerySchema = z.object({
  projectIds: z
    .string()
    .optional()
    .transform((raw) => {
      if (!raw) return undefined;
      const ids = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return ids.length > 0 ? ids : undefined;
    }),
});
export type OverviewProjectsQuery = z.infer<typeof OverviewProjectsQuerySchema>;
