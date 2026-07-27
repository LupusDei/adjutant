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
