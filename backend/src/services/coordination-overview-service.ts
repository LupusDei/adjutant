/**
 * Coordination overview (Mission Control) rollup service — adj-208.1.2 / .4.1.
 *
 * Produces the `GET /api/overview/projects` payload: one
 * {@link ProjectStreamRollup} per project (active epic + completion, remaining
 * open epics/beads, assigned agents, status beacon) plus {@link PortfolioTotals}.
 *
 * PERFORMANCE (adj-208.4.1) — this endpoint must ALWAYS respond fast, even when a
 * project's dolt is cold/slow. Three defenses:
 *   1. ONE `bd list --all` per project (via injected {@link CoordinationOverviewDeps.fetchProjectBeads}),
 *      NOT the old N×M `bd show` fan-out that serialized through the bd mutex and
 *      hung 86s on a cold dolt. `bd list` embeds dependency edges, so epic
 *      completion is computed from that single call (no `bd show`).
 *   2. A per-project in-memory cache (TTL, stale-while-revalidate): a warm request
 *      serves cached rollups instantly and refreshes in the background — no bd call
 *      on the hot path.
 *   3. Per-project + hard overall timeouts: a slow project degrades to stale/empty
 *      (`degraded: true`) and NEVER blocks the others; the request always returns
 *      within the hard deadline.
 *
 * Layer: service (business logic). The route validates + envelopes; this file
 * owns all derivation. See `.claude/rules/04-architecture.md`.
 *
 * @module services/coordination-overview-service
 */
import type { Project } from "./projects-service.js";
import type { BeadsIssue } from "./bd-client.js";
import { computeEpicProgressFromDeps, excludeWisps } from "./beads/index.js";
import type { EpicProgress } from "./beads/index.js";
import type { CrewMember, AgentQuestion } from "../types/index.js";
import type { ServiceResult } from "../types/service-result.js";
import type {
  OverviewProjectsResponse,
  ProjectStreamRollup,
  ActiveEpic,
  AgentMarker,
  FeatureRollup,
  PortfolioTotals,
} from "../types/overview-projects.js";

// ============================================================================
// Dependencies + config (injected for reuse + testability)
// ============================================================================

/**
 * The read paths this service composes. Production wiring passes the real
 * functions (see `index.ts`); tests pass fixture-backed fakes.
 */
export interface CoordinationOverviewDeps {
  /** All registered projects (id, name, path, hasBeads). */
  listProjects: () => ServiceResult<Project[]>;
  /**
   * ONE `bd list --all --json` for a project — the single cheap bead snapshot
   * (statuses + embedded dependency edges) the rollup is derived from.
   */
  fetchProjectBeads: (
    projectPath: string
  ) => Promise<ServiceResult<BeadsIssue[]>>;
  /** All agents across the fleet (matched to projects by name). */
  getAgents: () => Promise<ServiceResult<CrewMember[]>>;
  /** Open agent questions for a project (drives `needs_input`). */
  listOpenQuestions: (projectId: string) => AgentQuestion[];
  /**
   * Recent `report_progress` cadence signal (adj-209.1.2): a count of recent
   * progress reports per agent id, within the caller's activity window. ONE
   * cheap indexed lookup per request (production reads the event store); the
   * service never fans out per epic. Optional — when omitted, activity still
   * rises with engaged agents + in-progress beads (cadence contributes 0).
   */
  getRecentProgressCounts?: () => Map<string, number>;
}

export interface CoordinationOverviewConfig {
  /** How long a cached bead rollup is served before it is considered stale. */
  cacheTtlMs?: number;
  /** Max wait for a single project's bead fetch before it degrades. */
  perProjectTimeoutMs?: number;
  /** Absolute upper bound on the whole request; unfinished projects degrade. */
  hardTimeoutMs?: number;
  /** Injectable clock (cache TTL); defaults to `Date.now`. */
  now?: () => number;
}

/** Options for a single {@link CoordinationOverviewService.getOverviewProjects} call. */
export interface GetOverviewProjectsOptions {
  /**
   * When present AND non-empty, roll up ONLY these project ids — the fast path:
   * unrequested projects are never fetched, so a small selection stays quick and
   * sidesteps cold-dolt "degraded" noise. Unknown ids are silently ignored.
   * Omitted or empty → roll up every project.
   */
  projectIds?: string[];
}

export interface CoordinationOverviewService {
  /** Build the portfolio rollup, optionally filtered to a subset of projects. */
  getOverviewProjects: (
    options?: GetOverviewProjectsOptions
  ) => Promise<OverviewProjectsResponse>;
}

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_PER_PROJECT_TIMEOUT_MS = 2_500;
const DEFAULT_HARD_TIMEOUT_MS = 4_000;

// ============================================================================
// Activity level — composite agentic intensity (adj-209.1.2)
// ============================================================================

/**
 * The three cheap, already-on-hand signals the composite intensity is built
 * from. All are counts; each is clamped to `>= 0` before weighting.
 */
export interface ActivitySignals {
  /** Agents actively engaged (working/booting/blocked/stuck — NOT idle/offline). */
  engagedAgents: number;
  /** In-progress (non-epic) beads in scope. */
  inProgressBeads: number;
  /** Recent `report_progress` reports in scope (cadence). */
  recentProgressReports: number;
}

/**
 * Relative weights. Engaged agents dominate (a live agent is the strongest
 * "hot" signal), in-progress beads reinforce, and progress cadence is the
 * lightest nudge (a single window can carry many reports). Tunable in one place.
 */
const ACTIVITY_WEIGHT_AGENTS = 1;
const ACTIVITY_WEIGHT_INPROGRESS = 0.6;
const ACTIVITY_WEIGHT_CADENCE = 0.35;

/**
 * Saturation constant for the `1 - e^(-raw/K)` curve. Larger K = slower ramp =
 * more headroom before the curve flattens. K=3 keeps realistic fleet loads
 * (a handful of agents/beads/reports) in the responsive 0.2–0.85 band so
 * "busier = hotter" always has room to grow.
 */
const ACTIVITY_SATURATION_K = 3;

/**
 * A hard ceiling BELOW 1 so the level never pins to fully-saturated: the map
 * always reads "there is room for more", and two extreme loads don't both
 * collapse to an identical `1`.
 */
const ACTIVITY_CEILING = 0.999;

/**
 * Composite agentic intensity in `[0, ACTIVITY_CEILING]`, strictly monotonic in
 * every signal. Pure and exported for direct unit testing.
 *
 * A weighted sum is squashed through a saturating exponential so the result is
 * bounded, additive across signals, and never fully saturates — giving the
 * Mission Control map a smooth "busier = hotter" encoding with real headroom.
 * Rounded to 3 decimals for compact, stable JSON.
 */
export function computeActivityLevel(signals: ActivitySignals): number {
  const raw =
    ACTIVITY_WEIGHT_AGENTS * Math.max(0, signals.engagedAgents) +
    ACTIVITY_WEIGHT_INPROGRESS * Math.max(0, signals.inProgressBeads) +
    ACTIVITY_WEIGHT_CADENCE * Math.max(0, signals.recentProgressReports);
  const level = 1 - Math.exp(-raw / ACTIVITY_SATURATION_K);
  const rounded = Math.round(level * 1000) / 1000;
  return Math.min(ACTIVITY_CEILING, rounded);
}

/** Agent statuses that count as "engaged" for the activity signal. */
const IDLE = "idle";
function isEngaged(a: AgentMarker): boolean {
  return a.status !== OFFLINE && a.status !== IDLE;
}

// ============================================================================
// Derived bead rollup (the cached, expensive-to-compute part)
// ============================================================================

/**
 * A single in-progress epic as derived PURELY from the bead snapshot — the
 * cacheable half of a feature. Live agents + the composite `activityLevel` are
 * overlaid at response time (they change faster than the bead graph), so this
 * carries the raw inputs for that overlay: `assignees` (to attribute agents)
 * and `inProgressChildren` (the activity signal).
 */
interface FeatureRollupData {
  id: string;
  title: string;
  completionPercent: number;
  closedChildren: number;
  totalChildren: number;
  status: string;
  /** Assignees of the epic + its child beads — used to attribute live agents. */
  assignees: string[];
  /** In-progress child beads of the epic — a per-feature activity signal. */
  inProgressChildren: number;
}

/** The per-project fields derived from the bead snapshot (what we cache). */
interface BeadRollup {
  activeEpic: ActiveEpic | null;
  epicsRemaining: number;
  openBeadsRemaining: number;
  hasBlocked: boolean;
  /** In-progress epics as branchable feature nodes (adj-209). */
  features: FeatureRollupData[];
  /** Count of in-progress (non-epic) beads — the project-level activity signal. */
  inProgressBeadCount: number;
}

const EMPTY_BEAD_ROLLUP: BeadRollup = {
  activeEpic: null,
  epicsRemaining: 0,
  openBeadsRemaining: 0,
  hasBlocked: false,
  features: [],
  inProgressBeadCount: 0,
};

// ============================================================================
// Pure helpers
// ============================================================================

/** Agent statuses that count as "active" — anything but offline. */
const OFFLINE = "offline";

/** Result of racing a promise against a deadline. */
type Timed<T> = { timedOut: false; value: T } | { timedOut: true };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Resolve `p`, or `{ timedOut: true }` if `ms` elapses first. */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<Timed<T>> {
  return Promise.race([
    p.then((value): Timed<T> => ({ timedOut: false, value })),
    delay(ms).then((): Timed<T> => ({ timedOut: true })),
  ]);
}

/**
 * Normalize `EpicProgress.completionPercent` (a FRACTION in [0,1] despite the
 * name) to an integer 0–100, clamped so malformed inputs stay in range.
 */
function toPercent(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.round(Math.min(1, Math.max(0, fraction)) * 100);
}

/**
 * The active epic: the in-progress epic with the most completed work (the list
 * is pre-sorted by completion desc) as the proxy for "most recent activity",
 * since the bead snapshot carries no per-epic activity timestamp. `null` if none.
 */
function pickActiveEpic(sortedProgress: EpicProgress[]): ActiveEpic | null {
  const active = sortedProgress.find((e) => e.status === "in_progress");
  if (!active) return null;
  return {
    id: active.id,
    title: active.title,
    completionPercent: toPercent(active.completionPercent),
    closedChildren: active.closedChildren,
    totalChildren: active.totalChildren,
  };
}

/**
 * Derive the per-project rollup from ONE `bd list --all` snapshot. Pure and
 * exported for direct unit testing against real bd-list shapes (Rule 1).
 *
 * `bd list` embeds each issue's dependency edges, so epic completion is computed
 * via the reused {@link computeEpicProgressFromDeps} (list-tuple branch) — no
 * `bd show` needed.
 */
export function rollupFromBeads(rawBeads: BeadsIssue[]): BeadRollup {
  const beads = excludeWisps(rawBeads);

  const statusMap = new Map<string, string>();
  const beadById = new Map<string, BeadsIssue>();
  for (const b of beads) {
    statusMap.set(b.id, b.status);
    beadById.set(b.id, b);
  }

  const epics: BeadsIssue[] = [];
  let openBeadsRemaining = 0;
  let inProgressBeadCount = 0;
  let hasBlocked = false;

  for (const b of beads) {
    // Spec: any bead in the project with status=blocked trips the beacon.
    if (b.status === "blocked") hasBlocked = true;
    if (b.issue_type === "epic") {
      epics.push(b);
      continue;
    }
    if (b.status === "open") openBeadsRemaining += 1;
    // Project-level activity signal: in-progress NON-epic beads (the epic is a
    // container, not a unit of work).
    if (b.status === "in_progress") inProgressBeadCount += 1;
  }

  const progress = epics
    .filter((e) => e.status === "open" || e.status === "in_progress")
    .map((e) => computeEpicProgressFromDeps(e, e.dependencies ?? [], statusMap))
    .sort((a, b) => b.completionPercent - a.completionPercent);

  // Features = the in-progress epics, each carrying the raw inputs the service
  // overlays live agents + activity onto. Derived from the SAME single snapshot
  // (no extra bd calls): child ids come from the epic's `bd list` edge tuples.
  const features: FeatureRollupData[] = epics
    .filter((e) => e.status === "in_progress")
    .map((epic) => {
      const prog = computeEpicProgressFromDeps(epic, epic.dependencies ?? [], statusMap);
      const assignees = new Set<string>();
      if (epic.assignee) assignees.add(epic.assignee);
      let inProgressChildren = 0;
      for (const dep of epic.dependencies ?? []) {
        if (dep.issue_id !== epic.id) continue;
        const child = beadById.get(dep.depends_on_id);
        if (!child) continue;
        if (child.assignee) assignees.add(child.assignee);
        if (child.status === "in_progress") inProgressChildren += 1;
      }
      return {
        id: epic.id,
        title: epic.title,
        completionPercent: toPercent(prog.completionPercent),
        closedChildren: prog.closedChildren,
        totalChildren: prog.totalChildren,
        status: epic.status,
        assignees: [...assignees],
        inProgressChildren,
      };
    })
    .sort((a, b) => b.completionPercent - a.completionPercent);

  return {
    activeEpic: pickActiveEpic(progress),
    epicsRemaining: progress.filter((e) => e.status === "open").length,
    openBeadsRemaining,
    inProgressBeadCount,
    hasBlocked,
    features,
  };
}

// ============================================================================
// Factory
// ============================================================================

export function createCoordinationOverviewService(
  deps: CoordinationOverviewDeps,
  config: CoordinationOverviewConfig = {}
): CoordinationOverviewService {
  const cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const perProjectTimeoutMs =
    config.perProjectTimeoutMs ?? DEFAULT_PER_PROJECT_TIMEOUT_MS;
  const hardTimeoutMs = config.hardTimeoutMs ?? DEFAULT_HARD_TIMEOUT_MS;
  const now = config.now ?? Date.now;

  /** Per-project cache of the expensive bead-derived rollup. */
  interface CacheEntry {
    data: BeadRollup;
    fetchedAt: number;
    refreshing: boolean;
  }
  const cache = new Map<string, CacheEntry>();

  /** Last-good agents snapshot, so a slow `getAgents` never flashes empty. */
  let lastAgents = new Map<string, AgentMarker[]>();

  /** Fetch + derive a project's bead rollup; null on bd error. */
  async function fetchBeadRollup(proj: Project): Promise<BeadRollup | null> {
    const res = await deps.fetchProjectBeads(proj.path);
    if (!res.success || !res.data) return null;
    return rollupFromBeads(res.data);
  }

  /** Background stale-while-revalidate refresh; updates cache, swallows errors. */
  function scheduleRefresh(proj: Project): void {
    const entry = cache.get(proj.id);
    if (entry?.refreshing) return;
    if (entry) entry.refreshing = true;
    void (async () => {
      const result = await withDeadline(fetchBeadRollup(proj), perProjectTimeoutMs);
      if (!result.timedOut && result.value !== null) {
        cache.set(proj.id, { data: result.value, fetchedAt: now(), refreshing: false });
      } else {
        const e = cache.get(proj.id);
        if (e) e.refreshing = false; // keep stale data; retry next request
      }
    })();
  }

  /**
   * Resolve a project's bead rollup honoring the cache + per-project timeout.
   * Never throws. `degraded` is true when serving empty fallback after a
   * cold-cache timeout/failure.
   */
  async function ensureBeadRollup(
    proj: Project
  ): Promise<{ data: BeadRollup; degraded: boolean }> {
    if (!proj.hasBeads) return { data: EMPTY_BEAD_ROLLUP, degraded: false };

    const entry = cache.get(proj.id);
    const age = entry ? now() - entry.fetchedAt : Number.POSITIVE_INFINITY;

    if (entry && age < cacheTtlMs) {
      return { data: entry.data, degraded: false }; // fresh — instant
    }
    if (entry) {
      // Stale-while-revalidate: serve stale instantly, refresh in background.
      scheduleRefresh(proj);
      return { data: entry.data, degraded: false };
    }

    // Cold cache — fetch inline, bounded by the per-project timeout.
    const result = await withDeadline(fetchBeadRollup(proj), perProjectTimeoutMs);
    if (!result.timedOut && result.value !== null) {
      cache.set(proj.id, { data: result.value, fetchedAt: now(), refreshing: false });
      return { data: result.value, degraded: false };
    }
    return { data: EMPTY_BEAD_ROLLUP, degraded: true };
  }

  /** Sum recent progress reports across a set of agents (cadence signal). */
  function progressReportsFor(
    agents: AgentMarker[],
    counts: Map<string, number>
  ): number {
    let total = 0;
    for (const a of agents) total += counts.get(a.id) ?? 0;
    return total;
  }

  /**
   * Compose one in-progress epic into a public {@link FeatureRollup}: attribute
   * the project's live agents by assignee match, then derive the per-feature
   * composite activity from (engaged agents + in-progress children + cadence).
   */
  function buildFeature(
    f: FeatureRollupData,
    projectAgents: AgentMarker[],
    progressCounts: Map<string, number>
  ): FeatureRollup {
    const agents = projectAgents.filter((a) => f.assignees.includes(a.id));
    const activityLevel = computeActivityLevel({
      engagedAgents: agents.filter(isEngaged).length,
      inProgressBeads: f.inProgressChildren,
      recentProgressReports: progressReportsFor(agents, progressCounts),
    });
    return {
      id: f.id,
      title: f.title,
      completionPercent: f.completionPercent,
      closedChildren: f.closedChildren,
      totalChildren: f.totalChildren,
      agents,
      activityLevel,
      status: f.status,
    };
  }

  function buildRollup(
    proj: Project,
    bead: BeadRollup,
    degraded: boolean,
    agentsByProjectName: Map<string, AgentMarker[]>,
    openQuestionCount: number,
    progressCounts: Map<string, number>
  ): ProjectStreamRollup {
    const agents = agentsByProjectName.get(proj.name) ?? [];
    const features = bead.features.map((f) =>
      buildFeature(f, agents, progressCounts)
    );
    // Project-level composite: ALL engaged agents + every in-progress bead +
    // total recent cadence across the project's agents. Same normalized curve
    // as the per-feature signal, so the project stream and its nodes share one
    // scale.
    const activityLevel = computeActivityLevel({
      engagedAgents: agents.filter(isEngaged).length,
      inProgressBeads: bead.inProgressBeadCount,
      recentProgressReports: progressReportsFor(agents, progressCounts),
    });
    return {
      projectId: proj.id,
      name: proj.name,
      activeEpic: bead.activeEpic,
      epicsRemaining: bead.epicsRemaining,
      openBeadsRemaining: bead.openBeadsRemaining,
      agents,
      status: bead.hasBlocked
        ? "blocked"
        : openQuestionCount > 0
          ? "needs_input"
          : "on_track",
      features,
      activityLevel,
      // Uncapped: the map renders the true agent count (no 5-dot cap, adj-209).
      agentCount: agents.length,
      degraded,
    };
  }

  /** Fetch agents (bounded); index by project name; fall back to last-good. */
  async function loadAgents(): Promise<Map<string, AgentMarker[]>> {
    const res = await withDeadline(deps.getAgents(), perProjectTimeoutMs);
    if (res.timedOut || !res.value.success || !res.value.data) return lastAgents;
    const byName = new Map<string, AgentMarker[]>();
    for (const a of res.value.data) {
      if (!a.project) continue;
      const list = byName.get(a.project) ?? [];
      list.push({ id: a.id, status: a.status });
      byName.set(a.project, list);
    }
    lastAgents = byName;
    return byName;
  }

  async function getOverviewProjects(
    options?: GetOverviewProjectsOptions
  ): Promise<OverviewProjectsResponse> {
    const projectsRes = deps.listProjects();
    if (!projectsRes.success || !projectsRes.data) {
      // Hard failure — the route turns this into a 500.
      throw new Error(
        projectsRes.error?.message ?? "Failed to list projects for overview"
      );
    }

    // adj-209.1.3 — optional projectIds allow-list. Filter BEFORE any bead fetch
    // so a small selection never pays for the unrequested projects; unknown ids
    // just fall out of the intersection (no error). Empty/absent → all projects.
    let projects = projectsRes.data;
    const filterIds = options?.projectIds;
    if (filterIds && filterIds.length > 0) {
      const wanted = new Set(filterIds);
      projects = projects.filter((p) => wanted.has(p.id));
    }

    const agentsByProjectName = await loadAgents();

    // ONE cheap lookup of recent progress cadence for the whole request (no
    // per-project/per-epic fan-out). Absent dep → no cadence signal.
    const progressCounts = deps.getRecentProgressCounts?.() ?? new Map<string, number>();

    // Absolute deadline: every project resolves by here (real, stale, or empty),
    // so the endpoint always responds within the hard timeout.
    const deadline = now() + hardTimeoutMs;

    const rollups = await Promise.all(
      projects.map(async (proj): Promise<ProjectStreamRollup> => {
        const openQuestions = deps.listOpenQuestions(proj.id);
        const remaining = Math.max(0, deadline - now());
        const raced = await withDeadline(ensureBeadRollup(proj), remaining);
        if (raced.timedOut) {
          // Hard deadline hit — serve last-known (stale) or empty, marked degraded.
          const data = cache.get(proj.id)?.data ?? EMPTY_BEAD_ROLLUP;
          return buildRollup(
            proj,
            data,
            true,
            agentsByProjectName,
            openQuestions.length,
            progressCounts
          );
        }
        return buildRollup(
          proj,
          raced.value.data,
          raced.value.degraded,
          agentsByProjectName,
          openQuestions.length,
          progressCounts
        );
      })
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
