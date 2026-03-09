import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks — must be defined before importing modules
// ============================================================================

vi.mock("../../src/services/tmux.js", () => ({
  listTmuxSessions: vi.fn(() => Promise.resolve(new Set<string>())),
}));

vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: vi.fn(() => ({
    listSessions: vi.fn(() => []),
  })),
}));

const mockEmit = vi.fn();
vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({ emit: mockEmit }),
}));

vi.mock("../../src/services/mcp-server.js", () => ({
  getConnectedAgents: vi.fn(() => []),
}));

vi.mock("../../src/services/mcp-tools/status.js", () => ({
  getAgentStatuses: vi.fn(() => new Map()),
}));

vi.mock("../../src/services/cost-tracker.js", () => ({
  getSessionCost: vi.fn(() => undefined),
  estimateContextPercent: vi.fn(() => 0),
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    readFileSync: vi.fn(() => "{}"),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
  };
});

import { listTmuxSessions } from "../../src/services/tmux.js";
import { getSessionBridge } from "../../src/services/session-bridge.js";
import { getAgents, resetAgentStatusCache } from "../../src/services/agents-service.js";
import { getSessionCost, estimateContextPercent } from "../../src/services/cost-tracker.js";
import type { CostEntry } from "../../src/services/cost-tracker.js";

// ============================================================================
// Test Helpers
// ============================================================================

function mockManagedSessions(sessions: Array<{
  id: string;
  name: string;
  tmuxSession: string;
  status?: string;
  projectPath?: string;
  workspaceType?: string;
  lastActivity?: string;
}>) {
  vi.mocked(getSessionBridge).mockReturnValue({
    listSessions: () => sessions.map(s => ({
      id: s.id,
      name: s.name,
      tmuxSession: s.tmuxSession,
      tmuxPane: `${s.tmuxSession}:0.0`,
      projectPath: s.projectPath ?? "/tmp/project",
      mode: "swarm" as const,
      status: (s.status ?? "idle") as "idle" | "working" | "waiting_permission" | "offline",
      workspaceType: (s.workspaceType ?? "primary") as "primary" | "worktree" | "copy",
      connectedClients: new Set<string>(),
      outputBuffer: [],
      pipeActive: false,
      createdAt: new Date(),
      lastActivity: new Date(s.lastActivity ?? new Date().toISOString()),
    })),
    getSession: vi.fn(),
    init: vi.fn(),
    createSession: vi.fn(),
    killSession: vi.fn(),
  } as never);
}

function makeCostEntry(overrides: Partial<CostEntry> = {}): CostEntry {
  return {
    sessionId: "sess-1",
    projectPath: "/tmp/project",
    tokens: { input: 50000, output: 10000, cacheRead: 20000, cacheWrite: 5000 },
    cost: 1.25,
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// estimateContextPercent tests
// ============================================================================

describe("estimateContextPercent", () => {
  // We need the REAL function for these tests, not the mock.
  // Import the real implementation directly for unit testing.
  // Since cost-tracker is mocked globally, we test via the mock return values
  // for integration tests, but for the unit function test we need the actual fn.

  // Use dynamic import to get the real module
  let realEstimateContextPercent: (entry: CostEntry, contextLimit?: number) => number;

  beforeEach(async () => {
    // Get the real implementation by importing the actual module
    const actual = await vi.importActual<typeof import("../../src/services/cost-tracker.js")>(
      "../../src/services/cost-tracker.js"
    );
    realEstimateContextPercent = actual.estimateContextPercent;
  });

  it("should return 0 for zero tokens", () => {
    const entry = makeCostEntry({
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    expect(realEstimateContextPercent(entry)).toBe(0);
  });

  it("should calculate percentage from input + output + cacheRead tokens", () => {
    // 50000 + 10000 + 20000 = 80000 out of 200000 = 40%
    const entry = makeCostEntry({
      tokens: { input: 50000, output: 10000, cacheRead: 20000, cacheWrite: 5000 },
    });
    expect(realEstimateContextPercent(entry)).toBe(40);
  });

  it("should cap at 100 when tokens exceed context limit", () => {
    const entry = makeCostEntry({
      tokens: { input: 150000, output: 80000, cacheRead: 50000, cacheWrite: 0 },
    });
    // 150000 + 80000 + 50000 = 280000 > 200000 → capped at 100
    expect(realEstimateContextPercent(entry)).toBe(100);
  });

  it("should use custom context limit when provided", () => {
    const entry = makeCostEntry({
      tokens: { input: 5000, output: 3000, cacheRead: 2000, cacheWrite: 0 },
    });
    // 5000 + 3000 + 2000 = 10000 out of 100000 = 10%
    expect(realEstimateContextPercent(entry, 100_000)).toBe(10);
  });

  it("should round to nearest integer", () => {
    const entry = makeCostEntry({
      tokens: { input: 33333, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    // 33333 / 200000 = 16.6665 → 17
    expect(realEstimateContextPercent(entry)).toBe(17);
  });

  it("should not include cacheWrite in calculation", () => {
    const entryWithWrite = makeCostEntry({
      tokens: { input: 50000, output: 10000, cacheRead: 20000, cacheWrite: 100000 },
    });
    const entryWithoutWrite = makeCostEntry({
      tokens: { input: 50000, output: 10000, cacheRead: 20000, cacheWrite: 0 },
    });
    expect(realEstimateContextPercent(entryWithWrite)).toBe(
      realEstimateContextPercent(entryWithoutWrite)
    );
  });

  it("should return exactly 50 at the 50% boundary", () => {
    const entry = makeCostEntry({
      tokens: { input: 100000, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    // 100000 / 200000 = 50%
    expect(realEstimateContextPercent(entry)).toBe(50);
  });

  it("should return exactly 100 at the cap boundary", () => {
    const entry = makeCostEntry({
      tokens: { input: 200000, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    // 200000 / 200000 = 100% (exactly at limit)
    expect(realEstimateContextPercent(entry)).toBe(100);
  });
});

// ============================================================================
// CrewMember cost enrichment tests
// ============================================================================

describe("agents-service cost enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAgentStatusCache();
  });

  it("should enrich CrewMember with cost and contextPercent when cost data exists", async () => {
    vi.mocked(listTmuxSessions).mockResolvedValue(new Set(["adj-swarm-alice"]));
    mockManagedSessions([
      { id: "s1", name: "alice", tmuxSession: "adj-swarm-alice" },
    ]);

    const costEntry = makeCostEntry({ sessionId: "s1", cost: 2.50 });
    vi.mocked(getSessionCost).mockReturnValue(costEntry);
    vi.mocked(estimateContextPercent).mockReturnValue(40);

    const result = await getAgents();

    expect(result.success).toBe(true);
    const alice = result.data?.find(a => a.name === "alice");
    expect(alice?.cost).toBe(2.50);
    expect(alice?.contextPercent).toBe(40);
  });

  it("should not set cost/contextPercent when no cost data exists", async () => {
    vi.mocked(listTmuxSessions).mockResolvedValue(new Set(["adj-swarm-alice"]));
    mockManagedSessions([
      { id: "s1", name: "alice", tmuxSession: "adj-swarm-alice" },
    ]);

    vi.mocked(getSessionCost).mockReturnValue(undefined);

    const result = await getAgents();

    expect(result.success).toBe(true);
    const alice = result.data?.find(a => a.name === "alice");
    expect(alice?.cost).toBeUndefined();
    expect(alice?.contextPercent).toBeUndefined();
  });

  it("should not set cost data for offline agents", async () => {
    vi.mocked(listTmuxSessions).mockResolvedValue(new Set()); // no tmux = offline
    mockManagedSessions([
      { id: "s1", name: "alice", tmuxSession: "adj-swarm-alice" },
    ]);

    const costEntry = makeCostEntry({ sessionId: "s1", cost: 1.00 });
    vi.mocked(getSessionCost).mockReturnValue(costEntry);
    vi.mocked(estimateContextPercent).mockReturnValue(25);

    const result = await getAgents();

    expect(result.success).toBe(true);
    const alice = result.data?.find(a => a.name === "alice");
    // Offline agents should not have cost data
    expect(alice?.status).toBe("offline");
    expect(alice?.cost).toBeUndefined();
    expect(alice?.contextPercent).toBeUndefined();
  });

  it("should enrich multiple agents independently", async () => {
    vi.mocked(listTmuxSessions).mockResolvedValue(new Set(["adj-swarm-alice", "adj-swarm-bob"]));
    mockManagedSessions([
      { id: "s1", name: "alice", tmuxSession: "adj-swarm-alice" },
      { id: "s2", name: "bob", tmuxSession: "adj-swarm-bob" },
    ]);

    const aliceCost = makeCostEntry({ sessionId: "s1", cost: 2.50 });
    vi.mocked(getSessionCost).mockImplementation((sid: string) => {
      if (sid === "s1") return aliceCost;
      return undefined; // bob has no cost data
    });
    vi.mocked(estimateContextPercent).mockReturnValue(40);

    const result = await getAgents();

    expect(result.success).toBe(true);
    const alice = result.data?.find(a => a.name === "alice");
    const bob = result.data?.find(a => a.name === "bob");
    expect(alice?.cost).toBe(2.50);
    expect(alice?.contextPercent).toBe(40);
    expect(bob?.cost).toBeUndefined();
    expect(bob?.contextPercent).toBeUndefined();
  });
});
