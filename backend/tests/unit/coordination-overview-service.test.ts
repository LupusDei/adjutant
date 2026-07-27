/**
 * Unit tests for the Mission Control coordination rollup service (adj-208.1.2).
 *
 * Rule 1 (real data shapes): the per-project bead/epic inputs are built from
 * REAL `bd list --json` output captured in `tests/fixtures/overview/bd-shapes.json`
 * and run through the SAME reused transforms the production service composes
 * (`transformBead`, `computeEpicProgressFromDeps`). Nothing is hand-crafted from
 * the TS `EpicProgress` / `BeadInfo` interfaces — the fixtures carry real CLI
 * fields (`owner`, `created_by`, `dependency_count`, `metadata`) that the TS
 * types do not even declare.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createCoordinationOverviewService } from "../../src/services/coordination-overview-service.js";
import type { CoordinationOverviewDeps } from "../../src/services/coordination-overview-service.js";
import { transformBead } from "../../src/services/beads/index.js";
import { computeEpicProgressFromDeps } from "../../src/services/beads/beads-dependency.js";
import type {
  BeadInfo,
  EpicProgress,
  ProjectBeadsOverview,
} from "../../src/services/beads/index.js";
import type { Project } from "../../src/services/projects-service.js";
import type { CrewMember, AgentQuestion } from "../../src/types/index.js";
import { ok, fail } from "../../src/types/service-result.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Fixture loading — REAL bd list shapes → domain objects via reused transforms
// ---------------------------------------------------------------------------

interface RawDep {
  issue_id: string;
  depends_on_id: string;
  type: string;
}
interface RawIssue {
  id: string;
  status: string;
  issue_type: string;
  dependencies?: RawDep[];
  [k: string]: unknown;
}
interface RawScenario {
  epics: RawIssue[];
  allBeads: RawIssue[];
  openBeads: RawIssue[];
  inProgressBeads: RawIssue[];
}

const FIXTURES = JSON.parse(
  readFileSync(
    resolve(__dirname, "../fixtures/overview/bd-shapes.json"),
    "utf-8"
  )
) as Record<string, RawScenario>;

/** Build EpicProgress[] exactly as the reused `computeEpicProgress` would. */
function epicsFor(scenario: string): EpicProgress[] {
  const fx = FIXTURES[scenario]!;
  const statusMap = new Map<string, string>();
  for (const b of fx.allBeads) statusMap.set(b.id, b.status);
  for (const e of fx.epics) statusMap.set(e.id, e.status);
  return fx.epics.map((e) =>
    // Cast: fixtures are real CLI shapes richer than BeadsIssue; the reused
    // function only reads id/title/status/assignee + the passed deps.
    computeEpicProgressFromDeps(
      e as never,
      e.dependencies ?? [],
      statusMap
    )
  );
}

/** Build ProjectBeadsOverview exactly as the reused `getProjectOverview` would. */
function overviewFor(scenario: string): ProjectBeadsOverview {
  const fx = FIXTURES[scenario]!;
  const open: BeadInfo[] = fx.openBeads.map((b) => transformBead(b as never, "project"));
  const inProgress: BeadInfo[] = fx.inProgressBeads.map((b) =>
    transformBead(b as never, "project")
  );
  return { open, inProgress, recentlyClosed: [] };
}

// ---------------------------------------------------------------------------
// Test factories
// ---------------------------------------------------------------------------

function project(overrides: Partial<Project> & { id: string; name: string; path: string }): Project {
  return {
    mode: "swarm",
    sessions: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    hasBeads: true,
    autoDevelop: false,
    ...overrides,
  };
}

function agent(id: string, projectName: string, status: string): CrewMember {
  return {
    id,
    name: id,
    type: "crew",
    project: projectName,
    status: status as CrewMember["status"],
  };
}

function question(projectId: string): AgentQuestion {
  return {
    id: `q-${projectId}`,
    projectId,
    agentId: "greenplace/Nib",
    body: "Which cache backend?",
    urgency: "high",
    status: "open",
    createdAt: "2026-07-22T10:00:00.000Z",
  };
}

/** Builds DI deps wiring fixture scenarios by project path. */
function makeDeps(config: {
  projects: Project[];
  scenarioByPath?: Record<string, string>;
  agents?: CrewMember[];
  questionsByProjectId?: Record<string, AgentQuestion[]>;
  overrides?: Partial<CoordinationOverviewDeps>;
}): CoordinationOverviewDeps {
  const scenarioByPath = config.scenarioByPath ?? {};
  return {
    listProjects: vi.fn(() => ok(config.projects)),
    getProjectOverview: vi.fn(async (path: string) => {
      const s = scenarioByPath[path];
      return s ? ok(overviewFor(s)) : ok({ open: [], inProgress: [], recentlyClosed: [] });
    }),
    computeEpicProgress: vi.fn(async (path: string) => {
      const s = scenarioByPath[path];
      return s ? ok(epicsFor(s)) : ok([]);
    }),
    getAgents: vi.fn(async () => ok(config.agents ?? [])),
    listOpenQuestions: vi.fn(
      (projectId: string) => config.questionsByProjectId?.[projectId] ?? []
    ),
    ...config.overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CoordinationOverviewService", () => {
  describe("happy path — a project with an active epic", () => {
    it("should roll up active epic, remaining work, agents, and on_track status", async () => {
      const deps = makeDeps({
        projects: [project({ id: "alpha-id", name: "alpha", path: "/alpha" })],
        scenarioByPath: { "/alpha": "alpha" },
        agents: [agent("A1", "alpha", "working"), agent("A2", "alpha", "idle")],
      });

      const svc = createCoordinationOverviewService(deps);
      const result = await svc.getOverviewProjects();

      expect(result.projects).toHaveLength(1);
      const p = result.projects[0]!;
      expect(p.projectId).toBe("alpha-id");
      expect(p.name).toBe("alpha");
      // alpha-1 in_progress: 2 of 3 children closed → 67% (fraction 0.667 normalized).
      expect(p.activeEpic).toEqual({
        id: "alpha-1",
        title: "Active epic — auth revamp",
        completionPercent: 67,
        closedChildren: 2,
        totalChildren: 3,
      });
      expect(p.epicsRemaining).toBe(1); // alpha-2 is open/not-started
      expect(p.openBeadsRemaining).toBe(3); // three open non-epic beads
      expect(p.agents).toEqual([
        { id: "A1", status: "working" },
        { id: "A2", status: "idle" },
      ]);
      expect(p.status).toBe("on_track");
    });
  });

  describe("no active epic", () => {
    it("should set activeEpic null and count all open epics as remaining", async () => {
      const deps = makeDeps({
        projects: [project({ id: "delta-id", name: "delta", path: "/delta" })],
        scenarioByPath: { "/delta": "delta" },
      });

      const svc = createCoordinationOverviewService(deps);
      const { projects, totals } = await svc.getOverviewProjects();

      const p = projects[0]!;
      expect(p.activeEpic).toBeNull();
      expect(p.epicsRemaining).toBe(2); // delta-1 + delta-2, both open
      expect(p.openBeadsRemaining).toBe(1);
      expect(p.status).toBe("on_track");
      // No active epic anywhere → portfolio completion is 0, not NaN.
      expect(totals.portfolioCompletionPercent).toBe(0);
    });
  });

  describe("status derivation", () => {
    it("should derive 'blocked' when any bead in the project is blocked", async () => {
      const deps = makeDeps({
        projects: [project({ id: "beta-id", name: "beta", path: "/beta" })],
        scenarioByPath: { "/beta": "beta" },
        // Even with an open question, blocked wins (precedence).
        questionsByProjectId: { "beta-id": [question("beta-id")] },
      });

      const svc = createCoordinationOverviewService(deps);
      const p = (await svc.getOverviewProjects()).projects[0]!;

      expect(p.status).toBe("blocked");
      // Active epic is still computed even when blocked (1 of 2 closed → 50%).
      expect(p.activeEpic?.id).toBe("beta-1");
      expect(p.activeEpic?.completionPercent).toBe(50);
    });

    it("should derive 'needs_input' when an open question exists and nothing is blocked", async () => {
      const deps = makeDeps({
        projects: [project({ id: "gamma-id", name: "gamma", path: "/gamma" })],
        scenarioByPath: { "/gamma": "gamma" },
        questionsByProjectId: { "gamma-id": [question("gamma-id")] },
      });

      const svc = createCoordinationOverviewService(deps);
      const p = (await svc.getOverviewProjects()).projects[0]!;

      expect(p.status).toBe("needs_input");
    });
  });

  describe("empty project (no beads)", () => {
    it("should return zeroed rollup and NOT query bd for a project without beads", async () => {
      const deps = makeDeps({
        projects: [
          project({ id: "eps-id", name: "epsilon", path: "/epsilon", hasBeads: false }),
        ],
      });

      const svc = createCoordinationOverviewService(deps);
      const p = (await svc.getOverviewProjects()).projects[0]!;

      expect(p.activeEpic).toBeNull();
      expect(p.epicsRemaining).toBe(0);
      expect(p.openBeadsRemaining).toBe(0);
      expect(p.agents).toEqual([]);
      expect(p.status).toBe("on_track");
      // Must NOT spend a bd call on a project with no beads database.
      expect(deps.getProjectOverview).not.toHaveBeenCalled();
      expect(deps.computeEpicProgress).not.toHaveBeenCalled();
    });
  });

  describe("portfolio totals across multiple projects", () => {
    it("should aggregate counts, beacons, active agents, and mean completion", async () => {
      const deps = makeDeps({
        projects: [
          project({ id: "alpha-id", name: "alpha", path: "/alpha" }),
          project({ id: "beta-id", name: "beta", path: "/beta" }),
          project({ id: "gamma-id", name: "gamma", path: "/gamma" }),
          project({ id: "delta-id", name: "delta", path: "/delta" }),
          project({ id: "eps-id", name: "epsilon", path: "/epsilon", hasBeads: false }),
        ],
        scenarioByPath: {
          "/alpha": "alpha",
          "/beta": "beta",
          "/gamma": "gamma",
          "/delta": "delta",
        },
        agents: [
          agent("A1", "alpha", "working"),
          agent("A2", "alpha", "idle"),
          agent("B1", "beta", "working"),
          agent("G1", "gamma", "working"),
          agent("Z1", "alpha", "offline"), // offline: excluded from agentsActive
        ],
        questionsByProjectId: { "gamma-id": [question("gamma-id")] },
      });

      const svc = createCoordinationOverviewService(deps);
      const { projects, totals } = await svc.getOverviewProjects();

      expect(projects).toHaveLength(5);
      expect(totals.projects).toBe(5);
      // Non-offline agents: A1, A2, B1, G1 = 4 (Z1 offline excluded).
      expect(totals.agentsActive).toBe(4);
      // epicsRemaining: alpha(1) + delta(2) = 3.
      expect(totals.epicsRemaining).toBe(3);
      // openBeadsRemaining: alpha(3) + gamma(1) + delta(1) = 5.
      expect(totals.openBeadsRemaining).toBe(5);
      expect(totals.blocked).toBe(1); // beta
      expect(totals.needsInput).toBe(1); // gamma
      // Active epics: alpha(67) + beta(50) + gamma(0) → mean 39 (delta/epsilon none).
      expect(totals.portfolioCompletionPercent).toBe(39);
    });
  });

  describe("resilience", () => {
    it("should throw when listProjects fails (route surfaces a 500)", async () => {
      const deps = makeDeps({ projects: [] });
      deps.listProjects = vi.fn(() => fail("DB_ERROR", "projects unavailable"));
      const svc = createCoordinationOverviewService(deps);
      await expect(svc.getOverviewProjects()).rejects.toThrow();
    });

    it("should degrade a project to empty bead data when its bd query fails", async () => {
      const deps = makeDeps({
        projects: [project({ id: "alpha-id", name: "alpha", path: "/alpha" })],
        scenarioByPath: { "/alpha": "alpha" },
      });
      deps.getProjectOverview = vi.fn(async () => fail("CLI_ERROR", "bd timeout"));

      const svc = createCoordinationOverviewService(deps);
      const p = (await svc.getOverviewProjects()).projects[0]!;

      expect(p.openBeadsRemaining).toBe(0); // degraded, not thrown
      expect(p.status).toBe("on_track");
    });

    it("should not crash when getAgents fails (agents render empty)", async () => {
      const deps = makeDeps({
        projects: [project({ id: "alpha-id", name: "alpha", path: "/alpha" })],
        scenarioByPath: { "/alpha": "alpha" },
      });
      deps.getAgents = vi.fn(async () => fail("TMUX_ERROR", "no tmux"));

      const svc = createCoordinationOverviewService(deps);
      const { projects, totals } = await svc.getOverviewProjects();

      expect(projects[0]!.agents).toEqual([]);
      expect(totals.agentsActive).toBe(0);
    });
  });
});
