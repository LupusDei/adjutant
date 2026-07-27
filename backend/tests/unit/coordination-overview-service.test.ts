/**
 * Unit tests for the Mission Control coordination rollup service
 * (adj-208.1.2 / .4.1).
 *
 * Rule 1 (real data shapes): each project's bead snapshot is REAL
 * `bd list --all --json` output captured in `tests/fixtures/overview/bd-shapes.json`
 * and fed to the service via the injected `fetchProjectBeads`. Epic completion is
 * derived through the reused `computeEpicProgressFromDeps` (list-tuple branch) —
 * the exact path production now uses (adj-208.4.1 removed the `bd show` fan-out).
 * Fixtures carry real CLI fields (owner, created_by, metadata, dependency_count)
 * the TS types don't declare — grounded in the CLI, not the interfaces.
 *
 * Also covers the adj-208.4.1 resilience guarantees: a slow project degrades and
 * never blocks the others, and a warm cache serves without re-hitting bd.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCoordinationOverviewService,
  rollupFromBeads,
  computeActivityLevel,
} from "../../src/services/coordination-overview-service.js";
import type { CoordinationOverviewDeps } from "../../src/services/coordination-overview-service.js";
import type { BeadsIssue } from "../../src/services/bd-client.js";
import type { Project } from "../../src/services/projects-service.js";
import type { CrewMember, AgentQuestion } from "../../src/types/index.js";
import { ok, fail } from "../../src/types/service-result.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Fixtures — REAL `bd list --all` snapshots per project
// ---------------------------------------------------------------------------

interface RawScenario {
  beads: BeadsIssue[];
}
const FIXTURES = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/overview/bd-shapes.json"), "utf-8")
) as Record<string, RawScenario>;

function beadsFor(scenario: string): BeadsIssue[] {
  return FIXTURES[scenario]!.beads;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function project(
  overrides: Partial<Project> & { id: string; name: string; path: string }
): Project {
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
  return { id, name: id, type: "crew", project: projectName, status: status as CrewMember["status"] };
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

/** Builds DI deps; `scenarioByPath` maps a project path to a fixture scenario. */
function makeDeps(config: {
  projects: Project[];
  scenarioByPath?: Record<string, string>;
  agents?: CrewMember[];
  questionsByProjectId?: Record<string, AgentQuestion[]>;
  /** Recent `report_progress` count per agent id (activity cadence signal). */
  recentProgressCounts?: Record<string, number>;
  overrides?: Partial<CoordinationOverviewDeps>;
}): CoordinationOverviewDeps {
  const scenarioByPath = config.scenarioByPath ?? {};
  return {
    listProjects: vi.fn(() => ok(config.projects)),
    fetchProjectBeads: vi.fn(async (path: string) => {
      const s = scenarioByPath[path];
      return s ? ok(beadsFor(s)) : ok([] as BeadsIssue[]);
    }),
    getAgents: vi.fn(async () => ok(config.agents ?? [])),
    listOpenQuestions: vi.fn(
      (projectId: string) => config.questionsByProjectId?.[projectId] ?? []
    ),
    ...(config.recentProgressCounts
      ? {
          getRecentProgressCounts: vi.fn(
            () => new Map(Object.entries(config.recentProgressCounts!))
          ),
        }
      : {}),
    ...config.overrides,
  };
}

// ---------------------------------------------------------------------------
// computeActivityLevel (pure composite) — adj-209.1.2
// ---------------------------------------------------------------------------

describe("computeActivityLevel", () => {
  it("should be 0 when there is no agentic work", () => {
    expect(
      computeActivityLevel({
        engagedAgents: 0,
        inProgressBeads: 0,
        recentProgressReports: 0,
      })
    ).toBe(0);
  });

  it("should rise monotonically with engaged-agent count", () => {
    const one = computeActivityLevel({ engagedAgents: 1, inProgressBeads: 0, recentProgressReports: 0 });
    const two = computeActivityLevel({ engagedAgents: 2, inProgressBeads: 0, recentProgressReports: 0 });
    const three = computeActivityLevel({ engagedAgents: 3, inProgressBeads: 0, recentProgressReports: 0 });
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
  });

  it("should rise with in-progress bead count", () => {
    const lo = computeActivityLevel({ engagedAgents: 0, inProgressBeads: 1, recentProgressReports: 0 });
    const hi = computeActivityLevel({ engagedAgents: 0, inProgressBeads: 4, recentProgressReports: 0 });
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(lo);
  });

  it("should rise with recent report_progress cadence", () => {
    const lo = computeActivityLevel({ engagedAgents: 0, inProgressBeads: 0, recentProgressReports: 1 });
    const hi = computeActivityLevel({ engagedAgents: 0, inProgressBeads: 0, recentProgressReports: 6 });
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(lo);
  });

  it("should treat the three signals as additive (all > any one alone)", () => {
    const agentsOnly = computeActivityLevel({ engagedAgents: 1, inProgressBeads: 0, recentProgressReports: 0 });
    const all = computeActivityLevel({ engagedAgents: 1, inProgressBeads: 1, recentProgressReports: 1 });
    expect(all).toBeGreaterThan(agentsOnly);
  });

  it("should stay in [0,1] with real headroom — never pins to 1", () => {
    const maxed = computeActivityLevel({
      engagedAgents: 1000,
      inProgressBeads: 1000,
      recentProgressReports: 1000,
    });
    expect(maxed).toBeGreaterThan(0.9);
    expect(maxed).toBeLessThan(1);
  });

  it("should clamp negative inputs to 0 (never below the floor)", () => {
    expect(
      computeActivityLevel({
        engagedAgents: -5,
        inProgressBeads: -2,
        recentProgressReports: -3,
      })
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// rollupFromBeads (pure)
// ---------------------------------------------------------------------------

describe("rollupFromBeads", () => {
  it("should derive active epic + completion from bd list dependency edges", () => {
    const r = rollupFromBeads(beadsFor("alpha"));
    expect(r.activeEpic).toEqual({
      id: "alpha-1",
      title: "Active epic — auth revamp",
      completionPercent: 67, // 2 of 3 children closed
      closedChildren: 2,
      totalChildren: 3,
    });
    expect(r.epicsRemaining).toBe(1); // alpha-2 open
    expect(r.openBeadsRemaining).toBe(3); // alpha-2.1, alpha-2.2, alpha-3
    expect(r.hasBlocked).toBe(false);
  });

  it("should expose in-progress epics as features with child-derived activity inputs", () => {
    const r = rollupFromBeads(beadsFor("alpha"));
    // Only alpha-1 is in_progress (alpha-2 is an open backlog epic).
    expect(r.features).toHaveLength(1);
    const f = r.features[0]!;
    expect(f.id).toBe("alpha-1");
    expect(f.title).toBe("Active epic — auth revamp");
    expect(f.completionPercent).toBe(67);
    expect(f.closedChildren).toBe(2);
    expect(f.totalChildren).toBe(3);
    expect(f.status).toBe("in_progress");
    // alpha-1.3 (oauth callback) is the one in-progress child, assigned to Toast.
    expect(f.inProgressChildren).toBe(1);
    expect(f.assignees).toContain("greenplace/Toast");
    // Project-level in-progress bead count (non-epic): only alpha-1.3.
    expect(r.inProgressBeadCount).toBe(1);
  });

  it("should yield no features and zero in-progress beads when no epic is active", () => {
    const r = rollupFromBeads(beadsFor("delta"));
    expect(r.features).toEqual([]);
    expect(r.inProgressBeadCount).toBe(0);
  });

  it("should flag blocked and compute a partially-complete active epic", () => {
    const r = rollupFromBeads(beadsFor("beta"));
    expect(r.hasBlocked).toBe(true);
    expect(r.activeEpic?.id).toBe("beta-1");
    expect(r.activeEpic?.completionPercent).toBe(50); // 1 of 2
  });

  it("should return a null active epic when no epic is in progress", () => {
    const r = rollupFromBeads(beadsFor("delta"));
    expect(r.activeEpic).toBeNull();
    expect(r.epicsRemaining).toBe(2);
    expect(r.openBeadsRemaining).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getOverviewProjects
// ---------------------------------------------------------------------------

describe("CoordinationOverviewService.getOverviewProjects", () => {
  it("should roll up a healthy project (active epic, agents, on_track, not degraded)", async () => {
    const deps = makeDeps({
      projects: [project({ id: "alpha-id", name: "alpha", path: "/alpha" })],
      scenarioByPath: { "/alpha": "alpha" },
      agents: [agent("A1", "alpha", "working"), agent("A2", "alpha", "idle")],
    });
    const p = (await createCoordinationOverviewService(deps).getOverviewProjects()).projects[0]!;

    expect(p.projectId).toBe("alpha-id");
    expect(p.activeEpic?.id).toBe("alpha-1");
    expect(p.activeEpic?.completionPercent).toBe(67);
    expect(p.epicsRemaining).toBe(1);
    expect(p.openBeadsRemaining).toBe(3);
    expect(p.agents).toEqual([
      { id: "A1", status: "working" },
      { id: "A2", status: "idle" },
    ]);
    expect(p.status).toBe("on_track");
    expect(p.degraded).toBe(false);
  });

  it("should derive 'blocked' (precedence over an open question)", async () => {
    const deps = makeDeps({
      projects: [project({ id: "beta-id", name: "beta", path: "/beta" })],
      scenarioByPath: { "/beta": "beta" },
      questionsByProjectId: { "beta-id": [question("beta-id")] },
    });
    const p = (await createCoordinationOverviewService(deps).getOverviewProjects()).projects[0]!;
    expect(p.status).toBe("blocked");
  });

  it("should derive 'needs_input' when a question is open and nothing is blocked", async () => {
    const deps = makeDeps({
      projects: [project({ id: "gamma-id", name: "gamma", path: "/gamma" })],
      scenarioByPath: { "/gamma": "gamma" },
      questionsByProjectId: { "gamma-id": [question("gamma-id")] },
    });
    const p = (await createCoordinationOverviewService(deps).getOverviewProjects()).projects[0]!;
    expect(p.status).toBe("needs_input");
  });

  it("should zero out a project with no beads and NOT fetch bd", async () => {
    const deps = makeDeps({
      projects: [project({ id: "eps-id", name: "epsilon", path: "/epsilon", hasBeads: false })],
    });
    const p = (await createCoordinationOverviewService(deps).getOverviewProjects()).projects[0]!;
    expect(p.activeEpic).toBeNull();
    expect(p.openBeadsRemaining).toBe(0);
    expect(p.status).toBe("on_track");
    expect(p.degraded).toBe(false);
    expect(deps.fetchProjectBeads).not.toHaveBeenCalled();
  });

  it("should aggregate portfolio totals across projects", async () => {
    const deps = makeDeps({
      projects: [
        project({ id: "alpha-id", name: "alpha", path: "/alpha" }),
        project({ id: "beta-id", name: "beta", path: "/beta" }),
        project({ id: "gamma-id", name: "gamma", path: "/gamma" }),
        project({ id: "delta-id", name: "delta", path: "/delta" }),
        project({ id: "eps-id", name: "epsilon", path: "/epsilon", hasBeads: false }),
      ],
      scenarioByPath: { "/alpha": "alpha", "/beta": "beta", "/gamma": "gamma", "/delta": "delta" },
      agents: [
        agent("A1", "alpha", "working"),
        agent("A2", "alpha", "idle"),
        agent("B1", "beta", "working"),
        agent("G1", "gamma", "working"),
        agent("Z1", "alpha", "offline"),
      ],
      questionsByProjectId: { "gamma-id": [question("gamma-id")] },
    });
    const { projects, totals } = await createCoordinationOverviewService(deps).getOverviewProjects();

    expect(projects).toHaveLength(5);
    expect(totals.projects).toBe(5);
    expect(totals.agentsActive).toBe(4); // Z1 offline excluded
    expect(totals.epicsRemaining).toBe(3); // alpha 1 + delta 2
    expect(totals.openBeadsRemaining).toBe(5); // alpha 3 + gamma 1 + delta 1
    expect(totals.blocked).toBe(1);
    expect(totals.needsInput).toBe(1);
    expect(totals.portfolioCompletionPercent).toBe(39); // mean(67,50,0)
  });

  describe("features + activity (adj-209.1.2)", () => {
    it("should build features[] with assignee-attributed agents + per-feature and per-project activityLevel", async () => {
      const deps = makeDeps({
        projects: [
          project({ id: "alpha-id", name: "alpha", path: "/alpha" }),
          project({ id: "delta-id", name: "delta", path: "/delta" }),
        ],
        scenarioByPath: { "/alpha": "alpha", "/delta": "delta" },
        agents: [
          agent("greenplace/Toast", "alpha", "working"), // assignee of alpha-1.3
          agent("greenplace/Idle", "alpha", "idle"), // on project, not on the feature
          agent("greenplace/Doc", "delta", "idle"),
        ],
        recentProgressCounts: { "greenplace/Toast": 4 },
      });
      const { projects } = await createCoordinationOverviewService(deps).getOverviewProjects();
      const alpha = projects.find((p) => p.projectId === "alpha-id")!;
      const delta = projects.find((p) => p.projectId === "delta-id")!;

      // Uncapped agent count = ALL agents on the project.
      expect(alpha.agentCount).toBe(2);

      // Features = the project's in-progress epics.
      expect(alpha.features).toHaveLength(1);
      const f = alpha.features[0]!;
      expect(f.id).toBe("alpha-1");
      expect(f.completionPercent).toBe(67);
      expect(f.status).toBe("in_progress");
      // Only Toast is attributed to the feature (assignee of a child bead); Idle isn't.
      expect(f.agents).toEqual([{ id: "greenplace/Toast", status: "working" }]);
      expect(f.activityLevel).toBeGreaterThan(0);
      expect(f.activityLevel).toBeLessThanOrEqual(1);

      // Project-level activity is populated and the busy project is hotter than the quiet one.
      expect(alpha.activityLevel).toBeGreaterThan(0);
      expect(delta.features).toEqual([]);
      expect(delta.activityLevel).toBe(0);
      expect(alpha.activityLevel).toBeGreaterThan(delta.activityLevel);
    });

    it("should count engaged agents (working) but not idle in the project activity signal", async () => {
      const base = (status: string) =>
        makeDeps({
          projects: [project({ id: "delta-id", name: "delta", path: "/delta" })],
          scenarioByPath: { "/delta": "delta" }, // delta has no in-progress beads
          agents: [agent("greenplace/Doc", "delta", status)],
        });
      const working = (
        await createCoordinationOverviewService(base("working")).getOverviewProjects()
      ).projects[0]!;
      const idle = (
        await createCoordinationOverviewService(base("idle")).getOverviewProjects()
      ).projects[0]!;

      expect(working.activityLevel).toBeGreaterThan(0);
      expect(idle.activityLevel).toBe(0);
      expect(working.activityLevel).toBeGreaterThan(idle.activityLevel);
    });

    it("should raise a feature's activity with recent report_progress cadence", async () => {
      const build = (counts?: Record<string, number>) =>
        makeDeps({
          projects: [project({ id: "gamma-id", name: "gamma", path: "/gamma" })],
          scenarioByPath: { "/gamma": "gamma" },
          agents: [agent("greenplace/Nib", "gamma", "working")], // assignee of gamma-1.1
          ...(counts ? { recentProgressCounts: counts } : {}),
        });
      const quiet = (
        await createCoordinationOverviewService(build()).getOverviewProjects()
      ).projects[0]!.features[0]!;
      const chatty = (
        await createCoordinationOverviewService(
          build({ "greenplace/Nib": 8 })
        ).getOverviewProjects()
      ).projects[0]!.features[0]!;

      expect(chatty.id).toBe("gamma-1");
      expect(chatty.activityLevel).toBeGreaterThan(quiet.activityLevel);
    });

    it("should degrade to empty features + zero activity without throwing", async () => {
      const deps = makeDeps({
        projects: [project({ id: "alpha-id", name: "alpha", path: "/alpha" })],
        scenarioByPath: { "/alpha": "alpha" },
      });
      deps.fetchProjectBeads = vi.fn(async () => fail("CLI_ERROR", "bd exploded"));
      const p = (await createCoordinationOverviewService(deps).getOverviewProjects()).projects[0]!;
      expect(p.degraded).toBe(true);
      expect(p.features).toEqual([]);
      expect(p.activityLevel).toBe(0);
    });
  });

  describe("projectIds filter (adj-209.1.3)", () => {
    it("should roll up ONLY the requested projects and never fetch the rest", async () => {
      const deps = makeDeps({
        projects: [
          project({ id: "alpha-id", name: "alpha", path: "/alpha" }),
          project({ id: "beta-id", name: "beta", path: "/beta" }),
          project({ id: "gamma-id", name: "gamma", path: "/gamma" }),
        ],
        scenarioByPath: { "/alpha": "alpha", "/beta": "beta", "/gamma": "gamma" },
      });
      const start = Date.now();
      const { projects, totals } = await createCoordinationOverviewService(
        deps
      ).getOverviewProjects({ projectIds: ["alpha-id", "gamma-id"] });

      expect(projects.map((p) => p.projectId).sort()).toEqual(["alpha-id", "gamma-id"]);
      expect(totals.projects).toBe(2);
      // A small selection is the fast path: unrequested projects are never fetched.
      expect(deps.fetchProjectBeads).toHaveBeenCalledWith("/alpha");
      expect(deps.fetchProjectBeads).toHaveBeenCalledWith("/gamma");
      expect(deps.fetchProjectBeads).not.toHaveBeenCalledWith("/beta");
      expect(Date.now() - start).toBeLessThan(1000);
    });

    it("should ignore unknown project ids (no error, no existence leak)", async () => {
      const deps = makeDeps({
        projects: [project({ id: "alpha-id", name: "alpha", path: "/alpha" })],
        scenarioByPath: { "/alpha": "alpha" },
      });
      const { projects } = await createCoordinationOverviewService(
        deps
      ).getOverviewProjects({ projectIds: ["alpha-id", "does-not-exist"] });
      expect(projects.map((p) => p.projectId)).toEqual(["alpha-id"]);
    });

    it("should return no projects when every requested id is unknown", async () => {
      const deps = makeDeps({
        projects: [project({ id: "alpha-id", name: "alpha", path: "/alpha" })],
        scenarioByPath: { "/alpha": "alpha" },
      });
      const { projects, totals } = await createCoordinationOverviewService(
        deps
      ).getOverviewProjects({ projectIds: ["ghost"] });
      expect(projects).toEqual([]);
      expect(totals.projects).toBe(0);
      expect(deps.fetchProjectBeads).not.toHaveBeenCalled();
    });

    it("should roll up ALL projects when projectIds is omitted or empty", async () => {
      const deps = makeDeps({
        projects: [
          project({ id: "alpha-id", name: "alpha", path: "/alpha" }),
          project({ id: "beta-id", name: "beta", path: "/beta" }),
        ],
        scenarioByPath: { "/alpha": "alpha", "/beta": "beta" },
      });
      const svc = createCoordinationOverviewService(deps);
      expect((await svc.getOverviewProjects()).projects).toHaveLength(2);
      expect((await svc.getOverviewProjects({ projectIds: [] })).projects).toHaveLength(2);
    });
  });

  describe("resilience", () => {
    it("should throw when listProjects fails (route surfaces a 500)", async () => {
      const deps = makeDeps({ projects: [] });
      deps.listProjects = vi.fn(() => fail("DB_ERROR", "projects unavailable"));
      await expect(
        createCoordinationOverviewService(deps).getOverviewProjects()
      ).rejects.toThrow();
    });

    it("should degrade a project whose bd fetch fails, keeping it in the response", async () => {
      const deps = makeDeps({
        projects: [project({ id: "alpha-id", name: "alpha", path: "/alpha" })],
        scenarioByPath: { "/alpha": "alpha" },
      });
      deps.fetchProjectBeads = vi.fn(async () => fail("CLI_ERROR", "bd exploded"));
      const p = (await createCoordinationOverviewService(deps).getOverviewProjects()).projects[0]!;
      expect(p.degraded).toBe(true);
      expect(p.openBeadsRemaining).toBe(0);
      expect(p.activeEpic).toBeNull();
      expect(p.status).toBe("on_track");
    });

    it("should fall back to empty agents when getAgents fails", async () => {
      const deps = makeDeps({
        projects: [project({ id: "alpha-id", name: "alpha", path: "/alpha" })],
        scenarioByPath: { "/alpha": "alpha" },
      });
      deps.getAgents = vi.fn(async () => fail("TMUX_ERROR", "no tmux"));
      const { projects, totals } = await createCoordinationOverviewService(deps).getOverviewProjects();
      expect(projects[0]!.agents).toEqual([]);
      expect(totals.agentsActive).toBe(0);
    });
  });

  describe("performance guarantees (adj-208.4.1)", () => {
    it("should return promptly with the slow project degraded and the others intact", async () => {
      const deps = makeDeps({
        projects: [
          project({ id: "alpha-id", name: "alpha", path: "/alpha" }),
          project({ id: "slow-id", name: "slow", path: "/slow" }),
        ],
        scenarioByPath: { "/alpha": "alpha" },
      });
      // /slow's bead fetch takes far longer than the per-project timeout.
      deps.fetchProjectBeads = vi.fn(async (path: string) => {
        if (path === "/slow") {
          await new Promise<void>((r) => {
            setTimeout(r, 500);
          });
          return ok(beadsFor("alpha"));
        }
        return ok(beadsFor("alpha"));
      });

      const svc = createCoordinationOverviewService(deps, {
        perProjectTimeoutMs: 40,
        hardTimeoutMs: 200,
      });

      const start = Date.now();
      const { projects } = await svc.getOverviewProjects();
      const elapsed = Date.now() - start;

      // Must NOT wait for the 500ms slow project.
      expect(elapsed).toBeLessThan(300);

      const fast = projects.find((p) => p.projectId === "alpha-id")!;
      const slow = projects.find((p) => p.projectId === "slow-id")!;
      expect(fast.degraded).toBe(false);
      expect(fast.activeEpic?.id).toBe("alpha-1");
      expect(slow.degraded).toBe(true);
      expect(slow.activeEpic).toBeNull();
    });

    it("should serve a warm cache without re-fetching bd within the TTL", async () => {
      const fetchSpy = vi.fn(async () => ok(beadsFor("alpha")));
      const deps = makeDeps({
        projects: [project({ id: "alpha-id", name: "alpha", path: "/alpha" })],
        overrides: { fetchProjectBeads: fetchSpy },
      });
      const svc = createCoordinationOverviewService(deps, { cacheTtlMs: 30_000 });

      await svc.getOverviewProjects(); // cold — 1 fetch
      const second = await svc.getOverviewProjects(); // warm — cache hit, 0 fetch

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(second.projects[0]!.activeEpic?.id).toBe("alpha-1");
      expect(second.projects[0]!.degraded).toBe(false);
    });

    it("should serve stale instantly and refresh in the background once the TTL expires", async () => {
      let clock = 1_000;
      const fetchSpy = vi.fn(async () => ok(beadsFor("alpha")));
      const deps = makeDeps({
        projects: [project({ id: "alpha-id", name: "alpha", path: "/alpha" })],
        overrides: { fetchProjectBeads: fetchSpy },
      });
      const svc = createCoordinationOverviewService(deps, {
        cacheTtlMs: 100,
        now: () => clock,
      });

      await svc.getOverviewProjects(); // cold — fetch #1
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      clock = 1_250; // age 250 > TTL 100 → stale
      const stale = await svc.getOverviewProjects();
      // Stale-while-revalidate: instant, real (not degraded) data served from cache.
      expect(stale.projects[0]!.activeEpic?.id).toBe("alpha-1");
      expect(stale.projects[0]!.degraded).toBe(false);

      // ...and a background refresh was kicked off.
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });
    });
  });
});
