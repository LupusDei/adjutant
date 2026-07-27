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
    ...config.overrides,
  };
}

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
