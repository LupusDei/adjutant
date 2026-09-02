/**
 * adj-xugvt: ONE fleet roster, with the identity/session distinction made explicit.
 *
 * Two listings answered different questions and neither said so:
 *   - GET /api/agents was built from TMUX + bridge sessions — "who did this box
 *     spawn and can it type into".
 *   - MCP list_agents merged that with the live MCP connection map — "which
 *     identities are connected", wherever they run.
 * So a legitimate off-platform agent (Grok-hosted "Adjudicator", 2026-09-02;
 * reproduced live with worktree agent "fenix") appeared in one and not the
 * other, and the coordinator reading the wrong one concluded it did not exist.
 * The phantom `unknown-agent-<hash>` is the same divergence with the sign
 * flipped — a connection with no session AND no real identity.
 *
 * The fix is not to pick a registry. It is to answer once, and to carry the
 * distinction as DATA on each entry: `transport` (how we reach it) and
 * `injectable` (whether a local session can be typed into). Every consumer —
 * REST, the MCP tool, the DM resolver — reads this one function.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAgents = vi.fn();
const mockGetConnectedAgents = vi.fn();
const mockGetAgentStatuses = vi.fn();

vi.mock("../../src/services/agents-service.js", () => ({
  getAgents: (...args: unknown[]) => mockGetAgents(...args),
}));
vi.mock("../../src/services/mcp-server.js", () => ({
  getConnectedAgents: (...args: unknown[]) => mockGetConnectedAgents(...args),
}));
vi.mock("../../src/services/mcp-tools/status.js", () => ({
  getAgentStatuses: (...args: unknown[]) => mockGetAgentStatuses(...args),
}));

import { getFleetRoster } from "../../src/services/agent-roster.js";

/** A tmux/bridge-derived CrewMember, the shape agents-service returns. */
function crewMember(name: string, overrides: Record<string, unknown> = {}) {
  return {
    id: name,
    name,
    type: "agent",
    project: null,
    status: "working",
    isLive: true,
    ...overrides,
  };
}

/** A live MCP connection, the shape getConnectedAgents returns. */
function connection(agentId: string, sessionId = `sess-${agentId}`) {
  return { agentId, sessionId, connectedAt: new Date("2026-09-02T16:29:59.000Z") };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAgents.mockResolvedValue({ success: true, data: [] });
  mockGetConnectedAgents.mockReturnValue([]);
  mockGetAgentStatuses.mockReturnValue(new Map());
});

describe("getFleetRoster", () => {
  it("should mark a tmux-backed agent injectable", async () => {
    mockGetAgents.mockResolvedValue({ success: true, data: [crewMember("kerrigan")] });

    const roster = await getFleetRoster();

    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ id: "kerrigan", transport: "tmux", injectable: true });
  });

  it("should INCLUDE an agent that is live over MCP with no local session (the Adjudicator case)", async () => {
    mockGetConnectedAgents.mockReturnValue([connection("Adjudicator", "d9e010ea")]);

    const roster = await getFleetRoster();

    // Previously absent from GET /api/agents entirely, which is what made a
    // real, connected agent look nonexistent to the coordinator.
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      id: "Adjudicator",
      name: "Adjudicator",
      isLive: true,
      transport: "mcp",
      injectable: false,
      sessionId: "d9e010ea",
    });
  });

  it("should carry an MCP-only agent's reported status, not a hardcoded idle", async () => {
    mockGetConnectedAgents.mockReturnValue([connection("Adjudicator")]);
    mockGetAgentStatuses.mockReturnValue(
      new Map([
        [
          "Adjudicator",
          { status: "working", task: "triaging", updatedAt: "2026-09-02T16:30:00.000Z" },
        ],
      ]),
    );

    const roster = await getFleetRoster();

    expect(roster[0]).toMatchObject({
      status: "working",
      currentTask: "triaging",
      lastSeen: "2026-09-02T16:30:00.000Z",
    });
  });

  it("should default an MCP-only agent with no reported status to idle", async () => {
    mockGetConnectedAgents.mockReturnValue([connection("Adjudicator")]);

    const roster = await getFleetRoster();

    expect(roster[0]?.status).toBe("idle");
  });

  it("should EXCLUDE placeholder unknown-agent-* connections from the roster", async () => {
    // These are sessions, not agents. Promoting them polluted the very census a
    // coordinator uses to decide whether to spawn — and nothing reaped them.
    mockGetConnectedAgents.mockReturnValue([
      connection("unknown-agent-482e7928"),
      connection("unknown"),
      connection("kerrigan"),
    ]);

    const roster = await getFleetRoster();

    expect(roster.map((a) => a.id)).toEqual(["kerrigan"]);
  });

  it("should enrich a tmux agent that also holds a live MCP connection without duplicating it", async () => {
    mockGetAgents.mockResolvedValue({ success: true, data: [crewMember("kerrigan")] });
    mockGetConnectedAgents.mockReturnValue([connection("kerrigan", "sess-1")]);

    const roster = await getFleetRoster();

    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      id: "kerrigan",
      sessionId: "sess-1",
      transport: "tmux",
      injectable: true,
    });
  });

  it("should still report connected agents when the tmux roster cannot be read", async () => {
    // Losing the tmux listing must not erase the fleet: an infrastructure blip
    // reported as "these agents do not exist" is the failure this bead is about.
    mockGetAgents.mockResolvedValue({ success: false, error: { message: "tmux down" } });
    mockGetConnectedAgents.mockReturnValue([connection("Adjudicator")]);

    const roster = await getFleetRoster();

    expect(roster.map((a) => a.id)).toEqual(["Adjudicator"]);
  });

  it("should return an empty roster rather than throwing when everything is empty", async () => {
    await expect(getFleetRoster()).resolves.toEqual([]);
  });
});
