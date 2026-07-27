/**
 * Coordination overview (Mission Control) rollup service — adj-208.1.2 / US1.
 *
 * Produces the `GET /api/overview/projects` payload: one
 * {@link ProjectStreamRollup} per project (active epic + completion, remaining
 * open epics/beads, assigned agents, status beacon) plus {@link PortfolioTotals}.
 *
 * REUSE, don't re-query: this service composes the EXISTING beads/agents/question
 * read paths (`getProjectOverview`, `computeEpicProgress`, `getAgents`, the
 * question store) via injected dependencies. It adds NO second bd access path —
 * it only aggregates and derives. The dependencies are injected so the
 * aggregation is unit-testable against real bd shapes without spawning `bd`.
 *
 * Layer: service (business logic). The route validates + envelopes; this file
 * owns all derivation. See `.claude/rules/04-architecture.md`.
 *
 * @module services/coordination-overview-service
 */
import type { Project } from "./projects-service.js";
import type { ProjectBeadsOverview, EpicProgress } from "./beads/index.js";
import type { CrewMember, AgentQuestion } from "../types/index.js";
import type { ServiceResult } from "../types/service-result.js";
import type {
  OverviewProjectsResponse,
  ProjectStreamRollup,
  ActiveEpic,
  AgentMarker,
  PortfolioTotals,
  ProjectRollupStatus,
} from "../types/overview-projects.js";

// ============================================================================
// Dependencies (injected for reuse + testability)
// ============================================================================

/**
 * The existing read paths this service composes. Production wiring passes the
 * real functions (see `routes/overview.ts`); tests pass fixture-backed fakes.
 */
export interface CoordinationOverviewDeps {
  /** All registered projects (id, name, path, hasBeads). */
  listProjects: () => ServiceResult<Project[]>;
  /** Reused: open/in-progress/blocked bead lists for a project path. */
  getProjectOverview: (
    projectPath: string
  ) => Promise<ServiceResult<ProjectBeadsOverview>>;
  /** Reused: open + in-progress epics with child completion for a project path. */
  computeEpicProgress: (
    projectPath: string
  ) => Promise<ServiceResult<EpicProgress[]>>;
  /** Reused: all agents across the fleet (matched to projects by name). */
  getAgents: () => Promise<ServiceResult<CrewMember[]>>;
  /** Reused: open agent questions for a project (drives `needs_input`). */
  listOpenQuestions: (projectId: string) => AgentQuestion[];
}

export interface CoordinationOverviewService {
  /** Build the full portfolio rollup in a single call. */
  getOverviewProjects: () => Promise<OverviewProjectsResponse>;
}

// ============================================================================
// Internal helpers (pure)
// ============================================================================

/** Agent statuses that count as "active" — anything but offline. */
const OFFLINE = "offline";

/**
 * Normalize the reused `EpicProgress.completionPercent` — which is a FRACTION
 * in [0, 1] despite its name — to an integer 0–100 for the API contract.
 * Clamped so malformed inputs can never emit out-of-range values.
 */
function toPercent(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.round(Math.min(1, Math.max(0, fraction)) * 100);
}

/**
 * Select the active epic: the epic currently holding in-progress work. Among
 * in-progress epics we take the most-progressed one (the reused list is already
 * sorted by completion desc) as the proxy for "most recent activity", since the
 * reused `EpicProgress` shape carries no timestamp. `null` when none is active.
 */
function pickActiveEpic(epics: EpicProgress[]): ActiveEpic | null {
  const active = epics.find((e) => e.status === "in_progress");
  if (!active) return null;
  return {
    id: active.id,
    title: active.title,
    completionPercent: toPercent(active.completionPercent),
    closedChildren: active.closedChildren,
    totalChildren: active.totalChildren,
  };
}

/** Count of open, not-started epics (the map's backlog indicator). */
function countEpicsRemaining(epics: EpicProgress[]): number {
  return epics.filter((e) => e.status === "open").length;
}

/**
 * Derive the status beacon: `blocked` if any bead is blocked; else
 * `needs_input` if there is an open question; else `on_track`.
 */
function deriveStatus(
  overview: ProjectBeadsOverview,
  openQuestionCount: number
): ProjectRollupStatus {
  // `getProjectOverview` merges blocked beads into `inProgress`; open beads are
  // status=open only. Check both defensively so any blocked bead trips the beacon.
  const hasBlocked =
    overview.inProgress.some((b) => b.status === "blocked") ||
    overview.open.some((b) => b.status === "blocked");
  if (hasBlocked) return "blocked";
  if (openQuestionCount > 0) return "needs_input";
  return "on_track";
}

const EMPTY_OVERVIEW: ProjectBeadsOverview = {
  open: [],
  inProgress: [],
  recentlyClosed: [],
};

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a coordination overview service bound to the given read paths.
 */
export function createCoordinationOverviewService(
  deps: CoordinationOverviewDeps
): CoordinationOverviewService {
  /** Build the rollup for a single project (never throws — degrades to empty). */
  async function rollupProject(
    proj: Project,
    agentsByProjectName: Map<string, AgentMarker[]>
  ): Promise<ProjectStreamRollup> {
    // Only spend a bd call when the project actually has a beads database.
    let overview: ProjectBeadsOverview = EMPTY_OVERVIEW;
    let epics: EpicProgress[] = [];

    if (proj.hasBeads) {
      const [overviewRes, epicsRes] = await Promise.all([
        deps.getProjectOverview(proj.path),
        deps.computeEpicProgress(proj.path),
      ]);
      if (overviewRes.success && overviewRes.data) overview = overviewRes.data;
      if (epicsRes.success && epicsRes.data) epics = epicsRes.data;
    }

    const openQuestions = deps.listOpenQuestions(proj.id);

    return {
      projectId: proj.id,
      name: proj.name,
      activeEpic: pickActiveEpic(epics),
      epicsRemaining: countEpicsRemaining(epics),
      openBeadsRemaining: overview.open.length,
      agents: agentsByProjectName.get(proj.name) ?? [],
      status: deriveStatus(overview, openQuestions.length),
    };
  }

  async function getOverviewProjects(): Promise<OverviewProjectsResponse> {
    const projectsRes = deps.listProjects();
    if (!projectsRes.success || !projectsRes.data) {
      // Hard failure — the route turns this into a 500.
      throw new Error(
        projectsRes.error?.message ?? "Failed to list projects for overview"
      );
    }
    const projects = projectsRes.data;

    // Agents are global; index them by project name (how `getAgents` labels them).
    const agentsRes = await deps.getAgents();
    const agentsByProjectName = new Map<string, AgentMarker[]>();
    if (agentsRes.success && agentsRes.data) {
      for (const a of agentsRes.data) {
        if (!a.project) continue;
        const list = agentsByProjectName.get(a.project) ?? [];
        list.push({ id: a.id, status: a.status });
        agentsByProjectName.set(a.project, list);
      }
    }

    const rollups = await Promise.all(
      projects.map((p) => rollupProject(p, agentsByProjectName))
    );

    return { projects: rollups, totals: computeTotals(rollups) };
  }

  return { getOverviewProjects };
}

// ============================================================================
// Portfolio totals (pure)
// ============================================================================

/**
 * Aggregate the per-project rollups into the map-header totals. Exported for
 * direct unit testing of the aggregation.
 */
export function computeTotals(rollups: ProjectStreamRollup[]): PortfolioTotals {
  let agentsActive = 0;
  let epicsRemaining = 0;
  let openBeadsRemaining = 0;
  let blocked = 0;
  let needsInput = 0;
  let completionSum = 0;
  let activeEpicCount = 0;

  for (const r of rollups) {
    for (const agent of r.agents) {
      if (agent.status !== OFFLINE) agentsActive += 1;
    }
    epicsRemaining += r.epicsRemaining;
    openBeadsRemaining += r.openBeadsRemaining;
    if (r.status === "blocked") blocked += 1;
    if (r.status === "needs_input") needsInput += 1;
    if (r.activeEpic) {
      completionSum += r.activeEpic.completionPercent;
      activeEpicCount += 1;
    }
  }

  return {
    projects: rollups.length,
    agentsActive,
    epicsRemaining,
    openBeadsRemaining,
    blocked,
    needsInput,
    portfolioCompletionPercent:
      activeEpicCount > 0 ? Math.round(completionSum / activeEpicCount) : 0,
  };
}
