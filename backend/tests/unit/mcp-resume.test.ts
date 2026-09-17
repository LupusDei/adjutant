/**
 * MCP resume surface (adj-dpgqc): `list_resumable_sessions` + `spawn_worker`'s
 * resume options.
 *
 * After the 2026-09-16 kernel panic the coordinator recovered agents by hand:
 * globbing ~/.claude/projects for a session id, building the spawner's launch line
 * from memory, then calling spawn_worker a SECOND time purely to adopt the tmux
 * session into the registry. These two tools are that recipe, made callable.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AdjutantState } from "../../src/services/adjutant/state-store.js";
import type { MessageStore } from "../../src/services/message-store.js";

vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

const mockGetAgentBySession = vi.fn();
vi.mock("../../src/services/mcp-server.js", () => ({
  getAgentBySession: (...args: unknown[]) => mockGetAgentBySession(...args),
}));

const mockSpawnAgent = vi.fn();
vi.mock("../../src/services/agent-spawner-service.js", () => ({
  spawnAgent: (...args: unknown[]) => mockSpawnAgent(...args),
}));

const mockListResumableSessionsForAgent = vi.fn();
vi.mock("../../src/services/transcript-discovery.js", () => ({
  listResumableSessionsForAgent: (...args: unknown[]) => mockListResumableSessionsForAgent(...args),
}));

const mockFindByName = vi.fn(() => [] as { projectPath: string }[]);
vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: () => ({
    registry: { findByName: mockFindByName },
    lifecycle: { killSession: vi.fn() },
  }),
}));

vi.mock("../../src/services/persona-service.js", () => ({
  getPersonaService: () => undefined,
}));

vi.mock("../../src/services/beads/beads-mutations.js", () => ({
  updateBead: vi.fn(),
}));

vi.mock("../../src/services/bd-client.js", () => ({
  execBd: vi.fn(),
}));

vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({ emit: vi.fn(), on: vi.fn() }),
}));

// ============================================================================
// Harness
// ============================================================================

interface ToolResult {
  content: { type: string; text: string }[];
}

interface Registered {
  description: string | undefined;
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<ToolResult>;
}

async function registerTools(): Promise<Map<string, Registered>> {
  const { registerCoordinationTools } = await import(
    "../../src/services/mcp-tools/coordination.js"
  );
  const tools = new Map<string, Registered>();
  const mockServer = {
    tool: (name: string, ...rest: unknown[]) => {
      const first = rest[0];
      const description = typeof first === "string" ? first : undefined;
      const schema = (typeof first === "string" ? rest[1] : first) as Record<string, unknown>;
      const handler = rest[rest.length - 1] as Registered["handler"];
      tools.set(name, { description, schema, handler });
    },
  } as unknown as Parameters<typeof registerCoordinationTools>[0];

  const state = {
    logDecision: vi.fn(),
    logSpawn: vi.fn(),
    getAgentProfile: vi.fn(),
  } as unknown as AdjutantState;

  registerCoordinationTools(mockServer, state, {} as MessageStore);
  return tools;
}

function parse(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

const COORDINATOR = { sessionId: "sess-coordinator" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAgentBySession.mockReturnValue("adjutant-coordinator");
  mockFindByName.mockReturnValue([]);
  mockSpawnAgent.mockResolvedValue({ success: true, sessionId: "new-session" });
});

// ============================================================================
// list_resumable_sessions
// ============================================================================

describe("list_resumable_sessions", () => {
  const SESSION = {
    sessionId: "ccc9f2df-5b0b-428a-a3f9-323c51d1c388",
    transcriptPath: "/home/.claude/projects/-repo-worktrees-kerrigan/ccc9f2df.jsonl",
    cwd: "/repo/worktrees/kerrigan",
    modifiedAt: "2026-09-16T20:54:00.000Z",
    sizeBytes: 2_386_827,
    firstPrompt: "You are a Layer 3 Squad Leader…",
    lastPrompt: "push the branch",
  };

  it("should be registered", async () => {
    const tools = await registerTools();
    expect(tools.has("list_resumable_sessions")).toBe(true);
  });

  it("should return the agent's sessions, newest first", async () => {
    mockListResumableSessionsForAgent.mockResolvedValue([SESSION]);
    const tools = await registerTools();

    const result = await tools.get("list_resumable_sessions")!.handler(
      { agentName: "kerrigan" },
      COORDINATOR,
    );

    const body = parse(result);
    expect(body["success"]).toBe(true);
    expect(body["sessions"]).toEqual([SESSION]);
  });

  it("should search the working directory the registry already knows for that agent", async () => {
    mockFindByName.mockReturnValue([{ projectPath: "/repo/worktrees/kerrigan" }]);
    mockListResumableSessionsForAgent.mockResolvedValue([]);
    const tools = await registerTools();

    await tools.get("list_resumable_sessions")!.handler({ agentName: "kerrigan" }, COORDINATOR);

    expect(mockListResumableSessionsForAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentName: "kerrigan", knownCwd: "/repo/worktrees/kerrigan" }),
    );
  });

  it("should say plainly when an agent has nothing to resume from", async () => {
    mockListResumableSessionsForAgent.mockResolvedValue([]);
    const tools = await registerTools();

    const body = parse(
      await tools.get("list_resumable_sessions")!.handler({ agentName: "ghost" }, COORDINATOR),
    );

    expect(body["success"]).toBe(true);
    expect(body["sessions"]).toEqual([]);
  });

  it("should refuse a caller that is not the coordinator", async () => {
    mockGetAgentBySession.mockReturnValue("raynor");
    const tools = await registerTools();

    const result = await tools.get("list_resumable_sessions")!.handler(
      { agentName: "kerrigan" },
      { sessionId: "sess-raynor" },
    );

    // Same refusal shape the other coordination tools use: an error, not a result.
    expect((result as unknown as { isError?: boolean }).isError).toBe(true);
    expect(String(parse(result)["error"])).toMatch(/restricted/i);
    expect(mockListResumableSessionsForAgent).not.toHaveBeenCalled();
  });
});

// ============================================================================
// spawn_worker — resume
// ============================================================================

describe("spawn_worker — resume options", () => {
  const RESUME_ID = "ccc9f2df-5b0b-428a-a3f9-323c51d1c388";

  it("should pass resumeSessionId and resumeNote to the spawner", async () => {
    const tools = await registerTools();

    await tools.get("spawn_worker")!.handler(
      {
        agentName: "kerrigan",
        projectPath: "/repo",
        resumeSessionId: RESUME_ID,
        resumeNote: "The host rebooted at 20:54.",
      },
      COORDINATOR,
    );

    expect(mockSpawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "kerrigan",
        resumeSessionId: RESUME_ID,
        resumeNote: "The host rebooted at 20:54.",
      }),
    );
  });

  it("should not require a prompt when resuming — the transcript is the context", async () => {
    const tools = await registerTools();

    const body = parse(
      await tools.get("spawn_worker")!.handler(
        { agentName: "kerrigan", projectPath: "/repo", resumeSessionId: RESUME_ID },
        COORDINATOR,
      ),
    );

    expect(body["success"]).toBe(true);
    const arg = mockSpawnAgent.mock.calls[0]![0] as { initialPrompt?: string };
    expect(arg.initialPrompt).toBeUndefined();
  });

  it("should still require a prompt for a normal spawn", async () => {
    const tools = await registerTools();

    const body = parse(
      await tools.get("spawn_worker")!.handler({ agentName: "fresh-agent" }, COORDINATOR),
    );

    expect(body["success"]).toBe(false);
    expect(String(body["error"])).toMatch(/prompt/i);
    expect(mockSpawnAgent).not.toHaveBeenCalled();
  });

  it("should require an agent name when resuming — a resume is always someone specific", async () => {
    const tools = await registerTools();

    const body = parse(
      await tools.get("spawn_worker")!.handler(
        { projectPath: "/repo", resumeSessionId: RESUME_ID },
        COORDINATOR,
      ),
    );

    expect(body["success"]).toBe(false);
    expect(String(body["error"])).toMatch(/agentName/i);
    expect(mockSpawnAgent).not.toHaveBeenCalled();
  });

  it("should report the spawner's refusal rather than claiming success", async () => {
    mockSpawnAgent.mockResolvedValue({
      success: false,
      error: "Agent 'kerrigan' is already running in tmux session 'adj-swarm-kerrigan'.",
    });
    const tools = await registerTools();

    const body = parse(
      await tools.get("spawn_worker")!.handler(
        { agentName: "kerrigan", projectPath: "/repo", resumeSessionId: RESUME_ID },
        COORDINATOR,
      ),
    );

    expect(body["success"]).toBe(false);
    expect(String(body["error"])).toContain("already running");
  });
});
