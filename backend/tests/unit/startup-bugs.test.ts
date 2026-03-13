/**
 * Tests for adj-083: P0 startup bugs.
 *
 * Bug 1: MCP tool registration race condition
 * Bug 2: ngrok tunnel ignores NGROK_DOMAIN env var
 * Bug 3: Coordinator agent connects as 'unknown'
 * Bug 4: Stale pane auto-heal on every startup (naming drift)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Bug 1: MCP tool registration race — createMcpServer without registrar
// ============================================================================

vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({
    emit: vi.fn(),
    on: vi.fn(),
    onAny: vi.fn(),
  }),
}));

vi.mock("../../src/services/mcp-tools/status.js", () => ({
  clearAgentStatus: vi.fn(),
}));

vi.mock("../../src/services/bd-client.js", () => ({
  resolveBeadsDir: vi.fn(),
}));

vi.mock("../../src/services/projects-service.js", () => ({
  getProject: vi.fn(),
  listProjects: vi.fn(),
}));

// Mock MCP SDK to avoid import resolution issues in test env
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class MockMcpServer {
    connect = vi.fn();
    close = vi.fn();
  },
}));

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/shared/transport.js", () => ({}));

describe("Bug 1: MCP tool registration race condition", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("createMcpServer should throw when toolRegistrar is not set", async () => {
    const { createMcpServer, resetMcpServer } = await import(
      "../../src/services/mcp-server.js"
    );
    resetMcpServer();

    // Without toolRegistrar set, createMcpServer should throw
    // to prevent agents connecting with zero tools
    expect(() => createMcpServer()).toThrow(/tool registrar/i);
  });

  it("createMcpServer should succeed when toolRegistrar is set", async () => {
    const { createMcpServer, setToolRegistrar, resetMcpServer } = await import(
      "../../src/services/mcp-server.js"
    );
    resetMcpServer();

    const mockRegistrar = vi.fn();
    setToolRegistrar(mockRegistrar);

    const server = createMcpServer();
    expect(server).toBeDefined();
    expect(mockRegistrar).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Bug 2: ngrok tunnel should use NGROK_DOMAIN env var
// ============================================================================

// Mock child_process at module level
const mockSpawn = vi.fn();
vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

describe("Bug 2: ngrok tunnel uses NGROK_DOMAIN", () => {
  it("startTunnel should pass --url flag when NGROK_DOMAIN is set", async () => {
    // tunnel-service reads NGROK_DOMAIN at module top-level, so we need
    // fresh imports with the env set. resetModules clears cached modules.
    vi.resetModules();
    process.env["NGROK_DOMAIN"] = "cc.jmm.ngrok.io";

    // Re-register all mocks for fresh module resolution
    vi.doMock("../../src/utils/index.js", () => ({
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
      logDebug: vi.fn(),
    }));

    const localMockSpawn = vi.fn().mockReturnValue({
      on: vi.fn(),
      stderr: { on: vi.fn() },
      kill: vi.fn(),
    });

    vi.doMock("child_process", () => ({
      spawn: (...args: unknown[]) => localMockSpawn(...args),
    }));

    // Mock global fetch to avoid real network calls in checkNgrokApi()
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const tunnelService = await import("../../src/services/tunnel-service.js");

    // Start tunnel — don't await fully (it will hang polling ngrok API),
    // but give it enough ticks for the async getStatus() check to resolve
    // and reach the spawn() call.
    const promise = tunnelService.startTunnel();

    // Allow async ticks for getStatus() → checkNgrokApi() → fetch to resolve
    await new Promise((r) => setTimeout(r, 50));

    // Restore fetch
    globalThis.fetch = origFetch;

    // Verify spawn was called with --url flag
    expect(localMockSpawn).toHaveBeenCalledWith(
      "ngrok",
      ["http", "4200", "--url", "cc.jmm.ngrok.io"],
      expect.objectContaining({ detached: false }),
    );

    // Clean up
    delete process.env["NGROK_DOMAIN"];
  });
});

// ============================================================================
// Bug 3: Coordinator agent connects as 'unknown'
// ============================================================================

// Mock session bridge and tmux for adjutant-spawner tests
const mockBridgeCreateSession = vi.fn();
const mockDiscoverSessions = vi.fn();
const mockRegistrySave = vi.fn();
const mockFindByTmuxSession = vi.fn();
const mockLifecycle = { discoverSessions: mockDiscoverSessions };
const mockRegistry = {
  findByTmuxSession: mockFindByTmuxSession,
  save: mockRegistrySave,
};
const mockBridge = {
  lifecycle: mockLifecycle,
  registry: mockRegistry,
  createSession: mockBridgeCreateSession,
  init: vi.fn(),
};

vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: () => mockBridge,
}));

const mockListTmuxSessions = vi.fn();
vi.mock("../../src/services/tmux.js", () => ({
  listTmuxSessions: () => mockListTmuxSessions(),
}));

describe("Bug 3: Coordinator agent ID", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("spawnAdjutant should pass envVars with ADJUTANT_AGENT_ID", async () => {
    const { spawnAdjutant } = await import(
      "../../src/services/adjutant-spawner.js"
    );

    mockListTmuxSessions.mockResolvedValue(new Set());
    mockBridgeCreateSession.mockResolvedValue({
      success: true,
      sessionId: "s1",
    });

    await spawnAdjutant("/tmp/project");

    expect(mockBridgeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "adjutant-coordinator",
        envVars: expect.objectContaining({
          ADJUTANT_AGENT_ID: "adjutant-coordinator",
        }),
      }),
    );
  });
});

// ============================================================================
// Bug 4: Session naming consistency
// ============================================================================

describe("Bug 4: Session naming consistency", () => {
  it("ADJUTANT_TMUX_SESSION should use adj-swarm-adjutant-coordinator", async () => {
    const { ADJUTANT_TMUX_SESSION } = await import(
      "../../src/services/adjutant-spawner.js"
    );
    // The tmux session name should be consistent: adj-swarm-adjutant-coordinator
    expect(ADJUTANT_TMUX_SESSION).toBe("adj-swarm-adjutant-coordinator");
  });

  it("getAgentTmuxSession should produce consistent names", async () => {
    const { getAgentTmuxSession } = await import(
      "../../src/services/agent-spawner-service.js"
    );
    expect(getAgentTmuxSession("adjutant-coordinator")).toBe(
      "adj-swarm-adjutant-coordinator",
    );
  });
});
